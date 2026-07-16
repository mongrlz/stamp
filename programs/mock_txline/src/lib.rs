#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

declare_id!("8xo4Evfg7dcWjbYVcXZSbScqbWvGhjgSpaJzbiKrQX7m");

const DAILY_SCORES_SEED: &[u8] = b"daily_scores_roots";

#[program]
pub mod mock_txline {
    use super::*;

    pub fn initialize_daily_root(ctx: Context<InitializeDailyRoot>, _epoch_day: u16) -> Result<()> {
        ctx.accounts.daily_scores_roots.bump = ctx.bumps.daily_scores_roots;
        Ok(())
    }

    // Byte-identical instruction signature to TxLINE validate_stat_v3. This
    // local-only program returns true so integration tests cover STAMP's CPI,
    // return-data, state, vault, and payout behavior—not TxLINE's Merkle math.
    pub fn validate_stat_v3(
        _ctx: Context<ValidateStatV3>,
        _payload: StatValidationInputV3,
        _strategy: NDimensionalStrategy,
    ) -> Result<bool> {
        Ok(true)
    }
}

#[derive(Accounts)]
#[instruction(epoch_day: u16)]
pub struct InitializeDailyRoot<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + DailyRoot::INIT_SPACE,
        seeds = [DAILY_SCORES_SEED, &epoch_day.to_le_bytes()],
        bump,
    )]
    pub daily_scores_roots: Account<'info, DailyRoot>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ValidateStatV3<'info> {
    /// CHECK: local mock only; STAMP verifies the timestamp-derived PDA before CPI.
    pub daily_scores_roots: UncheckedAccount<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct DailyRoot {
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub enum Comparison {
    GreaterThan,
    LessThan,
    EqualTo,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub enum BinaryExpression {
    Add,
    Subtract,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ProofNode {
    pub hash: [u8; 32],
    pub is_right_sibling: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct TraderPredicate {
    pub threshold: i32,
    pub comparison: Comparison,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ScoreStat {
    pub key: u32,
    pub value: i32,
    pub period: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct StatLeaf {
    pub stat: ScoreStat,
    pub stat_proof: Vec<ProofNode>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ScoresUpdateStats {
    pub update_count: i32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ScoresBatchSummary {
    pub fixture_id: i64,
    pub update_stats: ScoresUpdateStats,
    pub events_sub_tree_root: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct StatValidationInputV3 {
    pub ts: i64,
    pub fixture_summary: ScoresBatchSummary,
    pub fixture_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
    pub event_stat_root: [u8; 32],
    pub leaves: Vec<StatLeaf>,
    pub multiproof_hashes: Vec<ProofNode>,
    pub leaf_indices: Vec<u32>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct GeometricTarget {
    pub stat_index: u8,
    pub prediction: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum StatPredicate {
    Single {
        index: u8,
        predicate: TraderPredicate,
    },
    Binary {
        index_a: u8,
        index_b: u8,
        op: BinaryExpression,
        predicate: TraderPredicate,
    },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct NDimensionalStrategy {
    pub geometric_targets: Vec<GeometricTarget>,
    pub distance_predicate: Option<TraderPredicate>,
    pub discrete_predicates: Vec<StatPredicate>,
}
