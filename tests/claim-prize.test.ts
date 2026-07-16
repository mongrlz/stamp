import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import BN from "bn.js";

import {
  claimEligibility,
  nextClaimAmount,
  type RawPosition,
} from "../services/wallet/src/claim-prize.js";

const owner = Keypair.generate().publicKey;
const poolAddress = Keypair.generate().publicKey;

function position(overrides: Partial<RawPosition> = {}): RawPosition {
  return {
    pool: poolAddress,
    owner,
    entryIndex: 1,
    paid: false,
    ...overrides,
  };
}

test("claim eligibility requires settled, unpaid winner membership", () => {
  const settled = { status: { settled: {} }, winnerMask: 0b0010 };
  assert.deepEqual(claimEligibility(settled, position()), {
    eligible: true,
    entryIndex: 1,
    reason: "eligible",
  });
  assert.equal(claimEligibility({ ...settled, status: { locked: {} } }, position()).reason, "not-settled");
  assert.equal(claimEligibility(settled, position({ paid: true })).reason, "already-paid");
  assert.equal(claimEligibility({ ...settled, winnerMask: 0b0001 }, position()).reason, "not-winner");
  assert.throws(() => claimEligibility(settled, position({ entryIndex: 16 })), /winner mask/);
});

test("claim amount matches equal split and gives integer dust to final winner", () => {
  assert.equal(nextClaimAmount({
    winnerCount: 3,
    winnersClaimed: 0,
    prizeTotal: new BN(10),
    claimedTotal: new BN(0),
  }), 3n);
  assert.equal(nextClaimAmount({
    winnerCount: 3,
    winnersClaimed: 2,
    prizeTotal: new BN(10),
    claimedTotal: new BN(6),
  }), 4n);
  assert.throws(() => nextClaimAmount({
    winnerCount: 0,
    winnersClaimed: 0,
    prizeTotal: new BN(10),
    claimedTotal: new BN(0),
  }), /winner counters/);
});
