import { PublicKey } from "@solana/web3.js";

import type { MatchFingerprint } from "../../../packages/txline/src/replay.js";
import type { PublicPool } from "./types.js";

export type BrowserPosition = {
  pool: PublicKey;
  owner: PublicKey;
  values: MatchFingerprint;
  entryIndex: number;
  paid: boolean;
  bump: number;
};

export type WalletPoolAction =
  | "connect"
  | "enter"
  | "waiting"
  | "claim"
  | "refund"
  | "paid"
  | "closed";

export function walletPoolAction(
  pool: PublicPool,
  owner: PublicKey | null,
  position: BrowserPosition | null,
): WalletPoolAction {
  if (!owner) return "connect";
  const entryIndex = pool.entries.findIndex(({ owner: entryOwner }) => entryOwner === owner.toBase58());
  const participant = entryIndex >= 0;
  if (pool.status === "open") return participant ? "waiting" : "enter";
  if (pool.status === "locked") return participant ? "waiting" : "closed";
  if (!participant || !position) return "closed";
  if (position.paid) return "paid";
  if (pool.status === "refundable") return "refund";
  if (pool.status === "settled" && (pool.winnerMask & (1 << position.entryIndex)) !== 0) {
    return "claim";
  }
  return "closed";
}
