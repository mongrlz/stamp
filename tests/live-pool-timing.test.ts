import assert from "node:assert/strict";
import test from "node:test";

import {
  LIVE_POOL_ENTRY_WINDOW_SECONDS,
  LIVE_POOL_FINALITY_MARGIN_SECONDS,
  LIVE_POOL_REFUND_GRACE_SECONDS,
  LIVE_POOL_SETTLEMENT_DELAY_SECONDS,
  planLivePoolTiming,
} from "../services/shared/src/live-pool-timing.js";

test("live pool timing closes entry before settlement and leaves the maximum claim window", () => {
  const nowMs = Date.parse("2026-07-16T20:35:00.000Z");
  const kickoffMs = Date.parse("2026-07-18T12:00:00.000Z");
  const timing = planLivePoolTiming({ nowMs, kickoffMs });

  assert.equal(timing.cutoffAt, nowMs / 1_000 + LIVE_POOL_ENTRY_WINDOW_SECONDS);
  assert.equal(
    timing.settleAfter,
    timing.cutoffAt + LIVE_POOL_SETTLEMENT_DELAY_SECONDS,
  );
  assert.equal(
    timing.refundAfter,
    timing.settleAfter + LIVE_POOL_REFUND_GRACE_SECONDS,
  );
  assert(timing.settleAfter < kickoffMs / 1_000);
  assert(kickoffMs / 1_000 + LIVE_POOL_FINALITY_MARGIN_SECONDS <= timing.refundAfter);
});

test("live pool timing rejects fixtures too near or too far for a safe final proof", () => {
  const nowMs = Date.parse("2026-07-16T20:35:00.000Z");
  assert.throws(
    () => planLivePoolTiming({ nowMs, kickoffMs: nowMs + 3 * 60 * 60 * 1_000 }),
    /starts too soon/,
  );
  assert.throws(
    () => planLivePoolTiming({ nowMs, kickoffMs: nowMs + 47 * 60 * 60 * 1_000 }),
    /starts too late/,
  );
});
