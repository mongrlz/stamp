export const LIVE_POOL_ENTRY_WINDOW_SECONDS = 10 * 60;
export const LIVE_POOL_SETTLEMENT_DELAY_SECONDS = 4 * 60 * 60;
export const LIVE_POOL_REFUND_GRACE_SECONDS = 48 * 60 * 60;
export const LIVE_POOL_FINALITY_MARGIN_SECONDS = 6 * 60 * 60;

export type LivePoolTiming = {
  cutoffAt: number;
  settleAfter: number;
  refundAfter: number;
};

export function planLivePoolTiming(options: {
  nowMs: number;
  kickoffMs: number;
}): LivePoolTiming {
  const { nowMs, kickoffMs } = options;
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(kickoffMs)) {
    throw new Error("Current time and kickoff must be safe integer millisecond timestamps");
  }

  const now = Math.floor(nowMs / 1_000);
  const kickoff = Math.floor(kickoffMs / 1_000);
  const cutoffAt = now + LIVE_POOL_ENTRY_WINDOW_SECONDS;
  const settleAfter = cutoffAt + LIVE_POOL_SETTLEMENT_DELAY_SECONDS;
  const refundAfter = settleAfter + LIVE_POOL_REFUND_GRACE_SECONDS;

  if (settleAfter >= kickoff) {
    throw new Error("Fixture starts too soon for STAMP's four-hour settlement delay");
  }
  if (kickoff + LIVE_POOL_FINALITY_MARGIN_SECONDS > refundAfter) {
    throw new Error(
      "Fixture starts too late: its final proof may arrive after STAMP's 48-hour refund deadline",
    );
  }

  return { cutoffAt, settleAfter, refundAfter };
}
