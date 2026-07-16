import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  mergeFinalizationRecord,
  writeFinalizationRecord,
  type FinalizationRecordUpdate,
} from "../services/keeper/src/finalization-record.js";

const pool = "3TGEb7Bwc1AZ1qxhFpQQZfxop9PZyiHPtyTKNybEZGWH";

function update(overrides: Partial<FinalizationRecordUpdate> = {}): FinalizationRecordUpdate {
  return {
    pool,
    recordedAt: "2026-07-19T01:15:00.000Z",
    settlement: {
      signature: "settle-signature",
      pool,
      fixtureId: 18_257_865,
      sequence: 77,
      finalVector: [2, 1, 5, 4],
      oracleRoots: "root-address",
    },
    claims: [{
      signature: "claim-signature",
      pool,
      winner: "winner-address",
      position: "position-address",
      winnerTokens: "token-address",
      entryIndex: 0,
      amount: "2000000",
    }],
    skipped: [{ owner: "loser-address", reason: "not-winner" }],
    snapshot: {
      status: "settled",
      finalVector: [2, 1, 5, 4],
      winnerMask: 1,
      winnerCount: 1,
      winnersClaimed: 1,
      winningDistance: 1,
      prizeTotal: "2000000",
      claimedTotal: "2000000",
      proofTs: "1784422900000",
      settlementRoot: [1, 2, 3],
      settler: "keeper-address",
      winners: [{ index: 0, owner: "winner-address" }],
      vaultAmount: "0",
    },
    ...overrides,
  };
}

test("finalization evidence marks only a fully claimed settled pool complete", () => {
  const merged = mergeFinalizationRecord({
    cluster: "devnet",
    livePool: { pool, status: "locked", vaultAmount: 2_000_000, transactions: {} },
  }, update());
  assert.equal(merged.livePool.status, "settled");
  assert.equal(merged.livePool.vaultAmount, "0");
  assert.equal(merged.livePool.finalization.complete, true);
  assert.equal(merged.livePool.transactions.settlement, "settle-signature");
  assert.deepEqual(merged.livePool.transactions.prizeClaims, [{
    winner: "winner-address",
    signature: "claim-signature",
    amount: "2000000",
  }]);
});

test("repeated checkpoints retain settlement evidence and deduplicate claims", () => {
  const first = mergeFinalizationRecord({ livePool: { pool, transactions: {} } }, update());
  const second = mergeFinalizationRecord(first, update({ settlement: null }));
  assert.equal(second.livePool.finalization.settlement.signature, "settle-signature");
  assert.equal(second.livePool.finalization.claims.length, 1);
});

test("finalization evidence rejects a different deployment pool", () => {
  assert.throws(
    () => mergeFinalizationRecord({ livePool: { pool: "other" } }, update()),
    /does not describe/,
  );
});

test("finalization evidence is atomically persisted as valid JSON", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stamp-finalization-"));
  const filePath = path.join(directory, "devnet.json");
  fs.writeFileSync(filePath, `${JSON.stringify({ livePool: { pool, transactions: {} } })}\n`);
  writeFinalizationRecord(filePath, update());
  const written = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.equal(written.livePool.finalization.complete, true);
  assert.deepEqual(fs.readdirSync(directory), ["devnet.json"]);
  fs.rmSync(directory, { recursive: true });
});
