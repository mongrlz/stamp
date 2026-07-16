import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";

export type RawPool = Record<string, any>;

export function poolStatus(pool: RawPool): string {
  const value = pool.status;
  if (!value || typeof value !== "object") return "unknown";
  return Object.keys(value as Record<string, unknown>)[0] ?? "unknown";
}

export function bnNumber(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (BN.isBN(value)) {
    const number = (value as BN).toNumber();
    if (Number.isSafeInteger(number)) return number;
  }
  throw new Error(`Pool field ${field} is not a safe integer`);
}

export function jsonValue(value: unknown): unknown {
  if (BN.isBN(value)) return (value as BN).toString();
  if (value instanceof PublicKey) return value.toBase58();
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return [...value];
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonValue(item)]),
    );
  }
  return value;
}

export function publicPool(address: PublicKey, pool: RawPool): Record<string, unknown> {
  const entryCount = bnNumber(pool.entryCount, "entryCount");
  return {
    address: address.toBase58(),
    creator: jsonValue(pool.creator),
    poolId: jsonValue(pool.poolId),
    fixtureId: jsonValue(pool.fixtureId),
    mint: jsonValue(pool.mint),
    tokenProgram: jsonValue(pool.tokenProgram),
    entryFee: jsonValue(pool.entryFee),
    cutoffAt: jsonValue(pool.cutoffAt),
    settleAfter: jsonValue(pool.settleAfter),
    refundAfter: jsonValue(pool.refundAfter),
    status: poolStatus(pool),
    maxEntries: pool.maxEntries,
    entryCount,
    finalVector: jsonValue(pool.finalVector),
    winnerMask: pool.winnerMask,
    winnerCount: pool.winnerCount,
    winnersClaimed: pool.winnersClaimed,
    winningDistance: pool.winningDistance,
    prizeTotal: jsonValue(pool.prizeTotal),
    claimedTotal: jsonValue(pool.claimedTotal),
    proofTs: jsonValue(pool.proofTs),
    settlementRoot: jsonValue(pool.settlementRoot),
    settler: jsonValue(pool.settler),
    entries: (pool.entries as Array<Record<string, unknown>>)
      .slice(0, entryCount)
      .map((entry, index) => ({
        index,
        owner: jsonValue(entry.owner),
        forecast: jsonValue(entry.values),
      })),
  };
}

function rootHex(value: unknown): string | null {
  if (!Array.isArray(value) && !(value instanceof Uint8Array)) return null;
  const bytes = Array.from(value as ArrayLike<number>);
  if (bytes.length !== 32 || bytes.every((byte) => byte === 0)) return null;
  return Buffer.from(bytes).toString("hex");
}

export function settlementReceipt(address: PublicKey, pool: RawPool): Record<string, unknown> {
  const status = poolStatus(pool);
  const entryCount = bnNumber(pool.entryCount, "entryCount");
  const winnerMask = Number(pool.winnerMask ?? 0);
  const entries = (pool.entries as Array<Record<string, unknown>>).slice(0, entryCount);
  const winners = entries.flatMap((entry, index) =>
    (winnerMask & (1 << index)) !== 0
      ? [{ index, owner: jsonValue(entry.owner), forecast: jsonValue(entry.values) }]
      : []
  );
  return {
    pool: address.toBase58(),
    fixtureId: jsonValue(pool.fixtureId),
    status,
    settled: status === "settled",
    finalVector: status === "settled" ? jsonValue(pool.finalVector) : null,
    winningDistance: status === "settled" ? pool.winningDistance : null,
    winnerCount: status === "settled" ? pool.winnerCount : 0,
    winners: status === "settled" ? winners : [],
    prizeTotal: jsonValue(pool.prizeTotal),
    claimedTotal: jsonValue(pool.claimedTotal),
    proof: status === "settled"
      ? {
          timestamp: jsonValue(pool.proofTs),
          eventSubtreeRootHex: rootHex(pool.settlementRoot),
          settler: jsonValue(pool.settler),
        }
      : null,
  };
}
