import path from "node:path";
import { PublicKey } from "@solana/web3.js";

import { readKeypair } from "../../shared/src/keypair.js";
import { bnNumber, poolStatus } from "../../shared/src/pool.js";
import {
  claimPrizeForOwner,
  inspectClaim,
  type ClaimResult,
} from "../../wallet/src/claim-prize.js";
import { createKeeperRuntime } from "./runtime.js";
import { fetchPool, settlePoolAddress, type SettlementResult } from "./settlement.js";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name} argument`);
  return value;
}

function repeatedArguments(name: string): string[] {
  return process.argv.flatMap((value, index) =>
    value === name && process.argv[index + 1] && !process.argv[index + 1]!.startsWith("--")
      ? [process.argv[index + 1]!]
      : []
  );
}

async function main(): Promise<void> {
  const runtime = createKeeperRuntime();
  const poolAddress = new PublicKey(argument("--pool"));
  const ownerPaths = repeatedArguments("--owner-keypair").map((value) => path.resolve(value));
  if (ownerPaths.length === 0) throw new Error("Provide at least one --owner-keypair argument");

  let pool = await fetchPool(runtime.program, poolAddress);
  let settlement: SettlementResult | null = null;
  const status = poolStatus(pool);
  if (status === "open" || status === "locked") {
    settlement = await settlePoolAddress({ ...runtime, poolAddress });
    pool = await fetchPool(runtime.program, poolAddress);
  }
  if (poolStatus(pool) !== "settled") {
    throw new Error(`Pool is ${poolStatus(pool)} after settlement attempt`);
  }

  const claims: ClaimResult[] = [];
  const skipped: Array<{ owner: string; reason: string }> = [];
  for (const ownerPath of ownerPaths) {
    const owner = readKeypair(ownerPath);
    const entryCount = bnNumber(pool.entryCount, "entryCount");
    const participant = (pool.entries as Array<{ owner: PublicKey }>)
      .slice(0, entryCount)
      .some((entry) => entry.owner.equals(owner.publicKey));
    if (!participant) {
      skipped.push({ owner: owner.publicKey.toBase58(), reason: "no-position" });
      continue;
    }
    const inspected = await inspectClaim({
      program: runtime.program,
      owner: owner.publicKey,
      poolAddress,
    });
    if (!inspected.eligibility.eligible) {
      skipped.push({ owner: owner.publicKey.toBase58(), reason: inspected.eligibility.reason });
      continue;
    }
    claims.push(await claimPrizeForOwner({ program: runtime.program, owner, poolAddress }));
  }
  process.stdout.write(`${JSON.stringify({
    pool: poolAddress.toBase58(),
    settlement,
    claims,
    skipped,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
