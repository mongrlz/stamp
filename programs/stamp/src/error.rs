use anchor_lang::prelude::*;

#[error_code]
pub enum StampError {
    #[msg("The pool configuration is invalid.")]
    InvalidPoolConfiguration,
    #[msg("This pool is not open for entries.")]
    PoolNotOpen,
    #[msg("The entry cutoff has passed.")]
    EntryCutoffPassed,
    #[msg("This pool has reached its participant limit.")]
    PoolFull,
    #[msg("Forecast values are outside the allowed range.")]
    InvalidForecast,
    #[msg("The pool cannot lock yet.")]
    CannotLockYet,
    #[msg("The pool has too few entries to settle.")]
    InsufficientEntries,
    #[msg("Settlement is not available yet.")]
    SettlementTooEarly,
    #[msg("This pool has already reached a terminal state.")]
    AlreadyResolved,
    #[msg("The supplied proof belongs to a different fixture.")]
    FixtureMismatch,
    #[msg("The supplied TxLINE proof has the wrong shape.")]
    InvalidProofShape,
    #[msg("The TxLINE proof is too early to be a final settlement proof.")]
    ProofTooEarly,
    #[msg("The supplied final stat vector contains an invalid value.")]
    InvalidFinalVector,
    #[msg("The TxLINE oracle program is not the pinned program.")]
    WrongOracleProgram,
    #[msg("The daily-scores account is not the PDA for the proof timestamp.")]
    WrongDailyRootAccount,
    #[msg("Failed to serialize the TxLINE CPI.")]
    OracleSerializationFailed,
    #[msg("TxLINE returned no validation result.")]
    OracleReturnedNothing,
    #[msg("The CPI return data was not produced by the pinned TxLINE program.")]
    OracleReturnMismatch,
    #[msg("TxLINE did not verify the supplied final vector.")]
    OutcomeNotVerified,
    #[msg("Arithmetic overflow.")]
    MathOverflow,
    #[msg("This wallet does not own a winning position.")]
    NotWinner,
    #[msg("This position has already been claimed or refunded.")]
    PositionAlreadyPaid,
    #[msg("This pool is not refundable.")]
    PoolNotRefundable,
    #[msg("The token account does not match the pool configuration.")]
    WrongTokenAccount,
}
