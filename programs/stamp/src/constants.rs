use anchor_lang::prelude::*;

pub const POOL_SEED: &[u8] = b"pool";
pub const VAULT_SEED: &[u8] = b"vault";
pub const POSITION_SEED: &[u8] = b"position";

pub const MAX_ENTRIES: usize = 16;
pub const MIN_ENTRIES_TO_SETTLE: u8 = 2;
pub const FORECAST_DIMENSIONS: usize = 4;
pub const STAT_KEYS: [u32; FORECAST_DIMENSIONS] = [1, 2, 7, 8];
// Current TxLINE v3 score-total leaves use final-match period 100. Finality is separately
// enforced by the pool's settle_after timestamp and the proof summary timestamp.
pub const FINAL_PERIOD: i32 = 100;
pub const DISTANCE_WEIGHTS: [u32; FORECAST_DIMENSIONS] = [3, 3, 1, 1];

pub const MAX_GOAL_PREDICTION: i16 = 20;
pub const MAX_CORNER_PREDICTION: i16 = 40;
pub const MAX_FINAL_STAT_VALUE: i32 = 100;
pub const MAX_SETTLEMENT_GRACE_SECONDS: i64 = 48 * 60 * 60;
#[cfg(feature = "mock-oracle")]
pub const MIN_SETTLEMENT_DELAY_SECONDS: i64 = 1;
#[cfg(not(feature = "mock-oracle"))]
pub const MIN_SETTLEMENT_DELAY_SECONDS: i64 = 4 * 60 * 60;
pub const MS_PER_DAY: i64 = 86_400_000;
pub const DAILY_SCORES_SEED: &[u8] = b"daily_scores_roots";

pub const TXORACLE_DEVNET: Pubkey = pubkey!("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
pub const TXORACLE_MAINNET: Pubkey = pubkey!("9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA");
pub const MOCK_TXORACLE: Pubkey = pubkey!("8xo4Evfg7dcWjbYVcXZSbScqbWvGhjgSpaJzbiKrQX7m");

#[cfg(feature = "mock-oracle")]
pub const ACTIVE_TXORACLE: Pubkey = MOCK_TXORACLE;
#[cfg(all(not(feature = "mock-oracle"), feature = "mainnet"))]
pub const ACTIVE_TXORACLE: Pubkey = TXORACLE_MAINNET;
#[cfg(all(not(feature = "mock-oracle"), not(feature = "mainnet")))]
pub const ACTIVE_TXORACLE: Pubkey = TXORACLE_DEVNET;
