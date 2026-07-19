import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import {
  TXLINE_DEVNET_PROGRAM_ID,
  TXLINE_FINAL_PERIOD,
} from "../packages/txline/src/constants.js";
import { deriveDailyScoresRoot, parseStampSettlementProof } from "../packages/txline/src/proof.js";

const hash = (byte: number): number[] => Array.from({ length: 32 }, () => byte);
const node = (byte: number, isRightSibling = false) => ({
  hash: hash(byte),
  isRightSibling,
});

function response() {
  return {
    ts: 1_782_946_530_877,
    summary: {
      fixtureId: 18_179_550,
      updateStats: {
        updateCount: 1,
        minTimestamp: 1_782_946_530_877,
        maxTimestamp: 1_782_946_530_877,
      },
      eventStatsSubTreeRoot: hash(1),
    },
    eventStatRoot: hash(2),
    statsToProve: [1, 2, 7, 8].map((key, index) => ({
      stat: { key, value: [3, 2, 4, 2][index], period: TXLINE_FINAL_PERIOD },
      statProof: [],
    })),
    multiproof: {
      hashes: [node(3, true), node(4)],
      indices: [32, 33, 36, 37],
    },
    subTreeProof: [node(5)],
    mainTreeProof: [node(6, true)],
  };
}

test("maps a real-shaped TxLINE v3 response into STAMP's Anchor argument", () => {
  const proof = parseStampSettlementProof(response(), 18_179_550);
  assert.deepEqual(proof.leafValues, [3, 2, 4, 2]);
  assert(proof.ts.eq(new BN("1782946530877")));
  assert.equal(proof.fixtureSummary.fixtureId.toNumber(), 18_179_550);
  assert.deepEqual(proof.leafIndices, [32, 33, 36, 37]);
});

test("rejects a reordered or substituted stat set", () => {
  const changed = response();
  changed.statsToProve[2]!.stat.key = 8;
  assert.throws(() => parseStampSettlementProof(changed, 18_179_550), /Unexpected stat key/);
});

test("derives the timestamp-specific TxLINE daily root deterministically", () => {
  const oracle = new PublicKey(TXLINE_DEVNET_PROGRAM_ID);
  const [first] = deriveDailyScoresRoot(oracle, 1_782_946_530_877);
  const [second] = deriveDailyScoresRoot(oracle, new BN("1782946530877"));
  assert(first.equals(second));
});
