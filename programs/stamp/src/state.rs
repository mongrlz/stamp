use anchor_lang::prelude::*;

use crate::constants::{FORECAST_DIMENSIONS, MAX_ENTRIES};

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq, InitSpace,
)]
pub struct ForecastEntry {
    pub owner: Pubkey,
    pub values: [i16; FORECAST_DIMENSIONS],
    pub occupied: bool,
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq, InitSpace,
)]
pub enum PoolStatus {
    #[default]
    Open,
    Locked,
    Settled,
    Refundable,
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub creator: Pubkey,
    pub pool_id: u64,
    pub fixture_id: i64,
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub entry_fee: u64,
    pub cutoff_at: i64,
    pub settle_after: i64,
    pub refund_after: i64,
    pub status: PoolStatus,
    pub max_entries: u8,
    pub entry_count: u8,
    pub bump: u8,
    pub vault_bump: u8,
    pub final_vector: [i32; FORECAST_DIMENSIONS],
    pub winner_mask: u16,
    pub winner_count: u8,
    pub winners_claimed: u8,
    pub winning_distance: u32,
    pub prize_total: u64,
    pub claimed_total: u64,
    pub proof_ts: i64,
    pub settlement_root: [u8; 32],
    pub settler: Pubkey,
    pub entries: [ForecastEntry; MAX_ENTRIES],
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub values: [i16; FORECAST_DIMENSIONS],
    pub entry_index: u8,
    pub paid: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreatePoolArgs {
    pub pool_id: u64,
    pub fixture_id: i64,
    pub entry_fee: u64,
    pub max_entries: u8,
    pub cutoff_at: i64,
    pub settle_after: i64,
    pub refund_after: i64,
}
