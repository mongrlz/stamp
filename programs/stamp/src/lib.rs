#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

pub mod constants;
pub mod error;
pub mod oracle;
pub mod state;

use constants::*;
use error::StampError;
use oracle::SettlementProofV3;
use state::{CreatePoolArgs, ForecastEntry, Pool, PoolStatus, Position};

declare_id!("7Xh5gJZN2SoYmDLsVQKtqFoB8pxrvykn9S8hjFWguE5o");

#[program]
pub mod stamp {
    use super::*;

    pub fn create_pool(ctx: Context<CreatePool>, args: CreatePoolArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            args.fixture_id > 0
                && args.entry_fee > 0
                && args.max_entries >= MIN_ENTRIES_TO_SETTLE
                && usize::from(args.max_entries) <= MAX_ENTRIES
                && args.cutoff_at > now
                && args.settle_after > args.cutoff_at
                && args.settle_after - args.cutoff_at >= MIN_SETTLEMENT_DELAY_SECONDS
                && args.refund_after > args.settle_after
                && args.refund_after - args.settle_after <= MAX_SETTLEMENT_GRACE_SECONDS,
            StampError::InvalidPoolConfiguration
        );

        let pool = &mut ctx.accounts.pool;
        pool.creator = ctx.accounts.creator.key();
        pool.pool_id = args.pool_id;
        pool.fixture_id = args.fixture_id;
        pool.mint = ctx.accounts.mint.key();
        pool.token_program = ctx.accounts.token_program.key();
        pool.entry_fee = args.entry_fee;
        pool.cutoff_at = args.cutoff_at;
        pool.settle_after = args.settle_after;
        pool.refund_after = args.refund_after;
        pool.status = PoolStatus::Open;
        pool.max_entries = args.max_entries;
        pool.entry_count = 0;
        pool.bump = ctx.bumps.pool;
        pool.vault_bump = ctx.bumps.vault;
        pool.final_vector = [0; FORECAST_DIMENSIONS];
        pool.winner_mask = 0;
        pool.winner_count = 0;
        pool.winners_claimed = 0;
        pool.winning_distance = 0;
        pool.prize_total = 0;
        pool.claimed_total = 0;
        pool.proof_ts = 0;
        pool.settlement_root = [0; 32];
        pool.settler = Pubkey::default();
        pool.entries = [ForecastEntry::default(); MAX_ENTRIES];

        emit!(PoolCreated {
            pool: pool.key(),
            creator: pool.creator,
            fixture_id: pool.fixture_id,
            entry_fee: pool.entry_fee,
            max_entries: pool.max_entries,
            cutoff_at: pool.cutoff_at,
        });
        Ok(())
    }

    pub fn enter_pool(ctx: Context<EnterPool>, values: [i16; FORECAST_DIMENSIONS]) -> Result<()> {
        validate_forecast(&values)?;
        let now = Clock::get()?.unix_timestamp;
        let pool = &ctx.accounts.pool;
        require!(pool.status == PoolStatus::Open, StampError::PoolNotOpen);
        require!(now < pool.cutoff_at, StampError::EntryCutoffPassed);
        require!(pool.entry_count < pool.max_entries, StampError::PoolFull);

        let transfer_accounts = TransferChecked {
            from: ctx.accounts.owner_tokens.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                transfer_accounts,
            ),
            pool.entry_fee,
            ctx.accounts.mint.decimals,
        )?;

        let pool = &mut ctx.accounts.pool;
        let entry_index = pool.entry_count;
        pool.entries[usize::from(entry_index)] = ForecastEntry {
            owner: ctx.accounts.owner.key(),
            values,
            occupied: true,
        };
        pool.entry_count = pool
            .entry_count
            .checked_add(1)
            .ok_or(error!(StampError::MathOverflow))?;
        if pool.entry_count == pool.max_entries {
            pool.status = PoolStatus::Locked;
        }

        let position = &mut ctx.accounts.position;
        position.pool = pool.key();
        position.owner = ctx.accounts.owner.key();
        position.values = values;
        position.entry_index = entry_index;
        position.paid = false;
        position.bump = ctx.bumps.position;

        emit!(ForecastEntered {
            pool: pool.key(),
            owner: position.owner,
            entry_index,
            values,
        });
        Ok(())
    }

    pub fn lock_pool(ctx: Context<LockPool>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.pool;
        require!(pool.status == PoolStatus::Open, StampError::PoolNotOpen);
        require!(
            pool.entry_count >= MIN_ENTRIES_TO_SETTLE,
            StampError::InsufficientEntries
        );
        require!(
            now >= pool.cutoff_at || pool.entry_count == pool.max_entries,
            StampError::CannotLockYet
        );
        pool.status = PoolStatus::Locked;
        emit!(PoolLocked {
            pool: pool.key(),
            entry_count: pool.entry_count,
            actor: ctx.accounts.actor.key(),
        });
        Ok(())
    }

    pub fn settle_pool(ctx: Context<SettlePool>, proof: SettlementProofV3) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pool = &ctx.accounts.pool;
        require!(
            pool.status == PoolStatus::Open || pool.status == PoolStatus::Locked,
            StampError::AlreadyResolved
        );
        require!(
            pool.entry_count >= MIN_ENTRIES_TO_SETTLE,
            StampError::InsufficientEntries
        );
        require!(now >= pool.settle_after, StampError::SettlementTooEarly);
        require!(
            proof.ts >= pool.settle_after.saturating_mul(1000)
                && proof.fixture_summary.update_stats.max_timestamp
                    >= pool.settle_after.saturating_mul(1000),
            StampError::ProofTooEarly
        );
        require!(
            proof.fixture_summary.update_stats.update_count > 0
                && proof.fixture_summary.update_stats.min_timestamp
                    <= proof.fixture_summary.update_stats.max_timestamp
                && proof.fixture_summary.update_stats.max_timestamp <= proof.ts,
            StampError::InvalidProofShape
        );
        validate_final_vector(&proof.leaf_values)?;
        require_keys_eq!(
            ctx.accounts.oracle_program.key(),
            ACTIVE_TXORACLE,
            StampError::WrongOracleProgram
        );
        require!(
            ctx.accounts.oracle_program.executable,
            StampError::WrongOracleProgram
        );

        oracle::verify_final_vector(
            &ctx.accounts.oracle_program.to_account_info(),
            &ctx.accounts.oracle_roots.to_account_info(),
            pool.fixture_id,
            &proof,
        )?;

        let actual: [i32; FORECAST_DIMENSIONS] = proof
            .leaf_values
            .as_slice()
            .try_into()
            .map_err(|_| error!(StampError::InvalidProofShape))?;
        let (winner_mask, winner_count, winning_distance) =
            rank_forecasts(&pool.entries, pool.entry_count, &actual)?;
        let prize_total = pool
            .entry_fee
            .checked_mul(u64::from(pool.entry_count))
            .ok_or(error!(StampError::MathOverflow))?;

        let pool = &mut ctx.accounts.pool;
        pool.status = PoolStatus::Settled;
        pool.final_vector = actual;
        pool.winner_mask = winner_mask;
        pool.winner_count = winner_count;
        pool.winners_claimed = 0;
        pool.winning_distance = winning_distance;
        pool.prize_total = prize_total;
        pool.claimed_total = 0;
        pool.proof_ts = proof.ts;
        pool.settlement_root = proof.fixture_summary.events_sub_tree_root;
        pool.settler = ctx.accounts.cranker.key();

        emit!(PoolSettled {
            pool: pool.key(),
            fixture_id: pool.fixture_id,
            final_vector: actual,
            winner_mask,
            winner_count,
            winning_distance,
            prize_total,
            proof_ts: proof.ts,
            settler: pool.settler,
        });
        Ok(())
    }

    pub fn claim_prize(ctx: Context<ClaimPrize>) -> Result<()> {
        let pool = &ctx.accounts.pool;
        require!(pool.status == PoolStatus::Settled, StampError::NotWinner);
        require!(!ctx.accounts.position.paid, StampError::PositionAlreadyPaid);
        let winner_bit = 1u16
            .checked_shl(u32::from(ctx.accounts.position.entry_index))
            .ok_or(error!(StampError::MathOverflow))?;
        require!(pool.winner_mask & winner_bit != 0, StampError::NotWinner);
        require!(pool.winner_count > 0, StampError::MathOverflow);

        let is_last_claim = pool
            .winners_claimed
            .checked_add(1)
            .ok_or(error!(StampError::MathOverflow))?
            == pool.winner_count;
        let amount = if is_last_claim {
            pool.prize_total
                .checked_sub(pool.claimed_total)
                .ok_or(error!(StampError::MathOverflow))?
        } else {
            pool.prize_total / u64::from(pool.winner_count)
        };

        transfer_from_vault(
            pool,
            &ctx.accounts.vault,
            &ctx.accounts.winner_tokens,
            &ctx.accounts.mint,
            &ctx.accounts.token_program,
            amount,
        )?;

        let pool = &mut ctx.accounts.pool;
        pool.winners_claimed = pool
            .winners_claimed
            .checked_add(1)
            .ok_or(error!(StampError::MathOverflow))?;
        pool.claimed_total = pool
            .claimed_total
            .checked_add(amount)
            .ok_or(error!(StampError::MathOverflow))?;
        ctx.accounts.position.paid = true;

        emit!(PrizeClaimed {
            pool: pool.key(),
            winner: ctx.accounts.winner.key(),
            amount,
        });
        Ok(())
    }

    pub fn mark_refundable(ctx: Context<MarkRefundable>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.pool;
        require!(
            pool.status == PoolStatus::Open || pool.status == PoolStatus::Locked,
            StampError::AlreadyResolved
        );
        let underfilled_after_cutoff =
            now >= pool.cutoff_at && pool.entry_count < MIN_ENTRIES_TO_SETTLE;
        require!(
            underfilled_after_cutoff || now >= pool.refund_after,
            StampError::PoolNotRefundable
        );
        pool.status = PoolStatus::Refundable;
        emit!(PoolMarkedRefundable {
            pool: pool.key(),
            actor: ctx.accounts.actor.key(),
        });
        Ok(())
    }

    pub fn refund_entry(ctx: Context<RefundEntry>) -> Result<()> {
        let pool = &ctx.accounts.pool;
        require!(
            pool.status == PoolStatus::Refundable,
            StampError::PoolNotRefundable
        );
        require!(!ctx.accounts.position.paid, StampError::PositionAlreadyPaid);

        transfer_from_vault(
            pool,
            &ctx.accounts.vault,
            &ctx.accounts.owner_tokens,
            &ctx.accounts.mint,
            &ctx.accounts.token_program,
            pool.entry_fee,
        )?;
        ctx.accounts.position.paid = true;

        emit!(EntryRefunded {
            pool: pool.key(),
            owner: ctx.accounts.owner.key(),
            amount: pool.entry_fee,
        });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(args: CreatePoolArgs)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Pool::INIT_SPACE,
        seeds = [POOL_SEED, creator.key().as_ref(), &args.pool_id.to_le_bytes()],
        bump,
    )]
    pub pool: Box<Account<'info, Pool>>,
    #[account(
        init,
        payer = creator,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = pool,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EnterPool<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(
        init,
        payer = owner,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, pool.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub position: Box<Account<'info, Position>>,
    #[account(
        mut,
        constraint = owner_tokens.owner == owner.key() @ StampError::WrongTokenAccount,
        constraint = owner_tokens.mint == pool.mint @ StampError::WrongTokenAccount,
    )]
    pub owner_tokens: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        constraint = vault.mint == pool.mint @ StampError::WrongTokenAccount,
        constraint = vault.owner == pool.key() @ StampError::WrongTokenAccount,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address = pool.mint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(address = pool.token_program)]
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LockPool<'info> {
    pub actor: Signer<'info>,
    #[account(mut)]
    pub pool: Box<Account<'info, Pool>>,
}

#[derive(Accounts)]
pub struct SettlePool<'info> {
    pub cranker: Signer<'info>,
    #[account(mut)]
    pub pool: Box<Account<'info, Pool>>,
    /// CHECK: pinned to ACTIVE_TXORACLE in the instruction before CPI.
    pub oracle_program: UncheckedAccount<'info>,
    /// CHECK: verified as TxLINE's timestamp-derived daily root PDA before CPI.
    pub oracle_roots: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ClaimPrize<'info> {
    #[account(mut)]
    pub winner: Signer<'info>,
    #[account(mut)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(
        mut,
        seeds = [POSITION_SEED, pool.key().as_ref(), winner.key().as_ref()],
        bump = position.bump,
        constraint = position.pool == pool.key(),
        constraint = position.owner == winner.key(),
    )]
    pub position: Box<Account<'info, Position>>,
    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        constraint = vault.mint == pool.mint @ StampError::WrongTokenAccount,
        constraint = vault.owner == pool.key() @ StampError::WrongTokenAccount,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = winner_tokens.owner == winner.key() @ StampError::WrongTokenAccount,
        constraint = winner_tokens.mint == pool.mint @ StampError::WrongTokenAccount,
    )]
    pub winner_tokens: Box<Account<'info, TokenAccount>>,
    #[account(address = pool.mint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(address = pool.token_program)]
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct MarkRefundable<'info> {
    pub actor: Signer<'info>,
    #[account(mut)]
    pub pool: Box<Account<'info, Pool>>,
}

#[derive(Accounts)]
pub struct RefundEntry<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub pool: Box<Account<'info, Pool>>,
    #[account(
        mut,
        seeds = [POSITION_SEED, pool.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        constraint = position.pool == pool.key(),
        constraint = position.owner == owner.key(),
    )]
    pub position: Box<Account<'info, Position>>,
    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        constraint = vault.mint == pool.mint @ StampError::WrongTokenAccount,
        constraint = vault.owner == pool.key() @ StampError::WrongTokenAccount,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = owner_tokens.owner == owner.key() @ StampError::WrongTokenAccount,
        constraint = owner_tokens.mint == pool.mint @ StampError::WrongTokenAccount,
    )]
    pub owner_tokens: Box<Account<'info, TokenAccount>>,
    #[account(address = pool.mint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(address = pool.token_program)]
    pub token_program: Program<'info, Token>,
}

fn validate_forecast(values: &[i16; FORECAST_DIMENSIONS]) -> Result<()> {
    require!(
        values[0] >= 0
            && values[0] <= MAX_GOAL_PREDICTION
            && values[1] >= 0
            && values[1] <= MAX_GOAL_PREDICTION
            && values[2] >= 0
            && values[2] <= MAX_CORNER_PREDICTION
            && values[3] >= 0
            && values[3] <= MAX_CORNER_PREDICTION,
        StampError::InvalidForecast
    );
    Ok(())
}

fn validate_final_vector(values: &[i32]) -> Result<()> {
    require!(
        values.len() == FORECAST_DIMENSIONS
            && values
                .iter()
                .all(|value| *value >= 0 && *value <= MAX_FINAL_STAT_VALUE),
        StampError::InvalidFinalVector
    );
    Ok(())
}

fn forecast_distance(
    forecast: &[i16; FORECAST_DIMENSIONS],
    actual: &[i32; FORECAST_DIMENSIONS],
) -> Result<u32> {
    let mut total = 0u64;
    for index in 0..FORECAST_DIMENSIONS {
        let delta = i64::from(actual[index]) - i64::from(forecast[index]);
        let weighted = delta
            .unsigned_abs()
            .checked_mul(u64::from(DISTANCE_WEIGHTS[index]))
            .ok_or(error!(StampError::MathOverflow))?;
        total = total
            .checked_add(weighted)
            .ok_or(error!(StampError::MathOverflow))?;
    }
    u32::try_from(total).map_err(|_| error!(StampError::MathOverflow))
}

fn rank_forecasts(
    entries: &[ForecastEntry; MAX_ENTRIES],
    entry_count: u8,
    actual: &[i32; FORECAST_DIMENSIONS],
) -> Result<(u16, u8, u32)> {
    require!(entry_count > 0, StampError::InsufficientEntries);
    let mut best = u32::MAX;
    let mut mask = 0u16;
    let mut winners = 0u8;

    for (index, entry) in entries.iter().take(usize::from(entry_count)).enumerate() {
        require!(entry.occupied, StampError::InvalidPoolConfiguration);
        let distance = forecast_distance(&entry.values, actual)?;
        if distance < best {
            best = distance;
            mask = 1u16
                .checked_shl(index as u32)
                .ok_or(error!(StampError::MathOverflow))?;
            winners = 1;
        } else if distance == best {
            mask |= 1u16
                .checked_shl(index as u32)
                .ok_or(error!(StampError::MathOverflow))?;
            winners = winners
                .checked_add(1)
                .ok_or(error!(StampError::MathOverflow))?;
        }
    }
    Ok((mask, winners, best))
}

fn transfer_from_vault<'info>(
    pool: &Account<'info, Pool>,
    vault: &Account<'info, TokenAccount>,
    destination: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    let pool_id = pool.pool_id.to_le_bytes();
    let bump = [pool.bump];
    let signer_seeds: &[&[u8]] = &[
        POOL_SEED,
        pool.creator.as_ref(),
        pool_id.as_ref(),
        bump.as_ref(),
    ];
    let signer = &[signer_seeds];
    let accounts = TransferChecked {
        from: vault.to_account_info(),
        mint: mint.to_account_info(),
        to: destination.to_account_info(),
        authority: pool.to_account_info(),
    };
    token::transfer_checked(
        CpiContext::new_with_signer(token_program.to_account_info(), accounts, signer),
        amount,
        mint.decimals,
    )
}

#[event]
pub struct PoolCreated {
    pub pool: Pubkey,
    pub creator: Pubkey,
    pub fixture_id: i64,
    pub entry_fee: u64,
    pub max_entries: u8,
    pub cutoff_at: i64,
}

#[event]
pub struct ForecastEntered {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub entry_index: u8,
    pub values: [i16; FORECAST_DIMENSIONS],
}

#[event]
pub struct PoolLocked {
    pub pool: Pubkey,
    pub entry_count: u8,
    pub actor: Pubkey,
}

#[event]
pub struct PoolSettled {
    pub pool: Pubkey,
    pub fixture_id: i64,
    pub final_vector: [i32; FORECAST_DIMENSIONS],
    pub winner_mask: u16,
    pub winner_count: u8,
    pub winning_distance: u32,
    pub prize_total: u64,
    pub proof_ts: i64,
    pub settler: Pubkey,
}

#[event]
pub struct PrizeClaimed {
    pub pool: Pubkey,
    pub winner: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PoolMarkedRefundable {
    pub pool: Pubkey,
    pub actor: Pubkey,
}

#[event]
pub struct EntryRefunded {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(owner_byte: u8, values: [i16; 4]) -> ForecastEntry {
        ForecastEntry {
            owner: Pubkey::new_from_array([owner_byte; 32]),
            values,
            occupied: true,
        }
    }

    #[test]
    fn goals_are_weighted_more_than_corners() {
        let actual = [2, 1, 5, 4];
        assert_eq!(forecast_distance(&[1, 1, 5, 4], &actual).unwrap(), 3);
        assert_eq!(forecast_distance(&[2, 1, 3, 4], &actual).unwrap(), 2);
    }

    #[test]
    fn ranking_records_every_closest_tie() {
        let mut entries = [ForecastEntry::default(); MAX_ENTRIES];
        entries[0] = entry(1, [2, 1, 4, 4]);
        entries[1] = entry(2, [2, 1, 6, 4]);
        entries[2] = entry(3, [3, 1, 5, 4]);
        let (mask, count, distance) = rank_forecasts(&entries, 3, &[2, 1, 5, 4]).unwrap();
        assert_eq!(mask, 0b0011);
        assert_eq!(count, 2);
        assert_eq!(distance, 1);
    }

    #[test]
    fn exact_fingerprint_wins() {
        let mut entries = [ForecastEntry::default(); MAX_ENTRIES];
        entries[0] = entry(1, [0, 0, 0, 0]);
        entries[1] = entry(2, [3, 2, 4, 2]);
        let (mask, count, distance) = rank_forecasts(&entries, 2, &[3, 2, 4, 2]).unwrap();
        assert_eq!(mask, 0b0010);
        assert_eq!(count, 1);
        assert_eq!(distance, 0);
    }
}
