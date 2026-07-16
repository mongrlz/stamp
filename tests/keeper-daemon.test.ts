import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
  actionForPool,
  runKeeperPass,
  type KeeperCandidate,
} from "../services/keeper/src/daemon-core.js";

function candidate(overrides: Partial<KeeperCandidate> = {}): KeeperCandidate {
  return {
    address: Keypair.generate().publicKey,
    status: "open",
    entryCount: 2,
    cutoffAt: 100,
    settleAfter: 200,
    refundAfter: 400,
    ...overrides,
  };
}

test("keeper action selection respects terminal, finality, and refund gates", () => {
  assert.equal(actionForPool(candidate({ status: "settled" }), 500), "skip");
  assert.equal(actionForPool(candidate(), 150), "wait");
  assert.equal(actionForPool(candidate(), 250), "settle");
  assert.equal(actionForPool(candidate({ entryCount: 1 }), 150), "refund");
  assert.equal(actionForPool(candidate(), 450), "refund");
});

test("keeper pass settles, refunds, and classifies missing finals without stopping other pools", async () => {
  const settle = candidate();
  const pending = candidate();
  const refund = candidate({ entryCount: 1 });
  const settledAddresses: string[] = [];
  const refundedAddresses: string[] = [];
  const results = await runKeeperPass({
    candidates: [settle, pending, refund],
    nowSeconds: 250,
    settle: async (address: PublicKey) => {
      if (address.equals(pending.address)) throw new Error("Fixture has no game_finalised event");
      settledAddresses.push(address.toBase58());
      return { signature: "settled-signature" };
    },
    markRefundable: async (address: PublicKey) => {
      refundedAddresses.push(address.toBase58());
      return "refund-signature";
    },
  });
  assert.deepEqual(settledAddresses, [settle.address.toBase58()]);
  assert.deepEqual(refundedAddresses, [refund.address.toBase58()]);
  assert.deepEqual(results.map(({ action }) => action), ["settle", "pending-final", "refund"]);
});
