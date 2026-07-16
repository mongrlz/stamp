import { PublicKey } from "@solana/web3.js";

export type KeeperCandidate = {
  address: PublicKey;
  status: string;
  entryCount: number;
  cutoffAt: number;
  settleAfter: number;
  refundAfter: number;
};

export type KeeperAction = "skip" | "wait" | "settle" | "refund";

export function actionForPool(pool: KeeperCandidate, nowSeconds: number): KeeperAction {
  if (pool.status !== "open" && pool.status !== "locked") return "skip";
  if (pool.entryCount < 2 && nowSeconds >= pool.cutoffAt) return "refund";
  if (nowSeconds >= pool.refundAfter) return "refund";
  if (pool.entryCount >= 2 && nowSeconds >= pool.settleAfter) return "settle";
  return "wait";
}

export type KeeperPassResult = {
  pool: string;
  action: KeeperAction | "pending-final" | "error";
  signature?: string;
  detail?: string;
};

export async function runKeeperPass(options: {
  candidates: KeeperCandidate[];
  nowSeconds?: number;
  settle(address: PublicKey): Promise<{ signature: string }>;
  markRefundable(address: PublicKey): Promise<string>;
}): Promise<KeeperPassResult[]> {
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const results: KeeperPassResult[] = [];
  for (const pool of options.candidates) {
    const address = pool.address.toBase58();
    const action = actionForPool(pool, now);
    if (action === "skip" || action === "wait") {
      results.push({ pool: address, action });
      continue;
    }
    try {
      if (action === "refund") {
        const signature = await options.markRefundable(pool.address);
        results.push({ pool: address, action, signature });
      } else {
        const settlement = await options.settle(pool.address);
        results.push({ pool: address, action, signature: settlement.signature });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const pendingFinal = action === "settle" && /game_finalised|finalized event|no final/i.test(detail);
      results.push({
        pool: address,
        action: pendingFinal ? "pending-final" : "error",
        detail,
      });
    }
  }
  return results;
}
