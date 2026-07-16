import fs from "node:fs";
import path from "node:path";

import type { ClaimResult } from "../../wallet/src/claim-prize.js";
import type { SettlementResult } from "./settlement.js";

type JsonObject = Record<string, any>;

export type FinalizationSnapshot = {
  status: string;
  finalVector: unknown;
  winnerMask: unknown;
  winnerCount: unknown;
  winnersClaimed: unknown;
  winningDistance: unknown;
  prizeTotal: unknown;
  claimedTotal: unknown;
  proofTs: unknown;
  settlementRoot: unknown;
  settler: unknown;
  winners: unknown;
  vaultAmount: string;
};

export type FinalizationRecordUpdate = {
  pool: string;
  recordedAt: string;
  settlement: SettlementResult | null;
  claims: ClaimResult[];
  skipped: Array<{ owner: string; reason: string }>;
  snapshot: FinalizationSnapshot;
};

function uniqueClaims(existing: ClaimResult[], incoming: ClaimResult[]): ClaimResult[] {
  const bySignature = new Map(existing.map((claim) => [claim.signature, claim]));
  for (const claim of incoming) bySignature.set(claim.signature, claim);
  return [...bySignature.values()];
}

export function mergeFinalizationRecord(
  deployment: JsonObject,
  update: FinalizationRecordUpdate,
): JsonObject {
  const livePool = deployment.livePool as JsonObject | undefined;
  if (!livePool || livePool.pool !== update.pool) {
    throw new Error("Deployment artifact does not describe the finalized pool");
  }
  const previous = (livePool.finalization ?? {}) as JsonObject;
  const claims = uniqueClaims(
    Array.isArray(previous.claims) ? previous.claims as ClaimResult[] : [],
    update.claims,
  );
  const settlement = update.settlement ?? previous.settlement ?? null;
  const complete = update.snapshot.status === "settled"
    && String(update.snapshot.claimedTotal) === String(update.snapshot.prizeTotal)
    && Number(update.snapshot.winnersClaimed) === Number(update.snapshot.winnerCount);
  const transactions = (livePool.transactions ?? {}) as JsonObject;

  return {
    ...deployment,
    livePool: {
      ...livePool,
      status: update.snapshot.status,
      vaultAmount: update.snapshot.vaultAmount,
      transactions: {
        ...transactions,
        ...(settlement ? { settlement: settlement.signature } : {}),
        prizeClaims: claims.map(({ winner, signature, amount }) => ({ winner, signature, amount })),
      },
      finalization: {
        complete,
        recordedAt: update.recordedAt,
        settlement,
        claims,
        skipped: update.skipped,
        chain: update.snapshot,
      },
    },
  };
}

export function writeFinalizationRecord(
  filePath: string,
  update: FinalizationRecordUpdate,
): void {
  const absolutePath = path.resolve(filePath);
  const deployment = JSON.parse(fs.readFileSync(absolutePath, "utf8")) as JsonObject;
  const merged = mergeFinalizationRecord(deployment, update);
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o644 });
  fs.renameSync(temporaryPath, absolutePath);
}
