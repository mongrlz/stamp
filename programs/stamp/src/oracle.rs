use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{get_return_data, invoke},
};

use crate::constants::{
    DAILY_SCORES_SEED, FINAL_PERIOD, FORECAST_DIMENSIONS, MS_PER_DAY, STAT_KEYS,
};
use crate::error::StampError;

pub const VALIDATE_STAT_V3_DISCRIMINATOR: [u8; 8] = [150, 37, 155, 89, 141, 190, 77, 203];

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Comparison {
    GreaterThan,
    LessThan,
    EqualTo,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
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
pub struct SettlementProofV3 {
    pub ts: i64,
    pub fixture_summary: ScoresBatchSummary,
    pub fixture_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
    pub event_stat_root: [u8; 32],
    pub leaf_values: Vec<i32>,
    pub multiproof_hashes: Vec<ProofNode>,
    pub leaf_indices: Vec<u32>,
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

pub fn daily_scores_pda(oracle_program: &Pubkey, ts_ms: i64) -> (Pubkey, u8) {
    let epoch_day = ts_ms.div_euclid(MS_PER_DAY) as u16;
    Pubkey::find_program_address(
        &[DAILY_SCORES_SEED, &epoch_day.to_le_bytes()],
        oracle_program,
    )
}

pub fn verify_final_vector<'info>(
    oracle_program: &AccountInfo<'info>,
    daily_scores_roots: &AccountInfo<'info>,
    fixture_id: i64,
    proof: &SettlementProofV3,
) -> Result<()> {
    require!(
        proof.fixture_summary.fixture_id == fixture_id,
        StampError::FixtureMismatch
    );
    require!(
        proof.leaf_values.len() == FORECAST_DIMENSIONS
            && proof.leaf_indices.len() == FORECAST_DIMENSIONS,
        StampError::InvalidProofShape
    );

    let (expected_root, _) = daily_scores_pda(oracle_program.key, proof.ts);
    require_keys_eq!(
        *daily_scores_roots.key,
        expected_root,
        StampError::WrongDailyRootAccount
    );

    let leaves = STAT_KEYS
        .iter()
        .zip(proof.leaf_values.iter())
        .map(|(key, value)| StatLeaf {
            stat: ScoreStat {
                key: *key,
                value: *value,
                period: FINAL_PERIOD,
            },
            stat_proof: Vec::new(),
        })
        .collect();

    // Each supplied value is used as an exact geometric target. TxLINE first
    // authenticates those values as Merkle leaves, then verifies distance < 1.
    // That covers all four leaves exactly once and returns true only for the
    // authenticated final vector.
    let geometric_targets = proof
        .leaf_values
        .iter()
        .enumerate()
        .map(|(index, value)| GeometricTarget {
            stat_index: index as u8,
            prediction: *value,
        })
        .collect();

    let payload = StatValidationInputV3 {
        ts: proof.ts,
        fixture_summary: proof.fixture_summary.clone(),
        fixture_proof: proof.fixture_proof.clone(),
        main_tree_proof: proof.main_tree_proof.clone(),
        event_stat_root: proof.event_stat_root,
        leaves,
        multiproof_hashes: proof.multiproof_hashes.clone(),
        leaf_indices: proof.leaf_indices.clone(),
    };
    let strategy = NDimensionalStrategy {
        geometric_targets,
        distance_predicate: Some(TraderPredicate {
            threshold: 1,
            comparison: Comparison::LessThan,
        }),
        discrete_predicates: Vec::new(),
    };

    let mut data = Vec::with_capacity(1400);
    data.extend_from_slice(&VALIDATE_STAT_V3_DISCRIMINATOR);
    payload
        .serialize(&mut data)
        .map_err(|_| error!(StampError::OracleSerializationFailed))?;
    strategy
        .serialize(&mut data)
        .map_err(|_| error!(StampError::OracleSerializationFailed))?;

    let ix = Instruction {
        program_id: *oracle_program.key,
        accounts: vec![AccountMeta::new_readonly(*daily_scores_roots.key, false)],
        data,
    };
    invoke(&ix, &[daily_scores_roots.clone(), oracle_program.clone()])?;

    let (returning_program, return_data) =
        get_return_data().ok_or(error!(StampError::OracleReturnedNothing))?;
    require_keys_eq!(
        returning_program,
        *oracle_program.key,
        StampError::OracleReturnMismatch
    );
    require!(
        return_data.first().copied().unwrap_or_default() == 1,
        StampError::OutcomeNotVerified
    );
    Ok(())
}
