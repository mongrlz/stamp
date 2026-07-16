import path from "node:path";
import { getAccount } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import { deriveVaultPda } from "../../../packages/stamp-sdk/src/pdas.js";
import { readKeypair } from "../../shared/src/keypair.js";
import {
  bnNumber,
  jsonValue,
  poolStatus,
  settlementReceipt,
  type RawPool,
} from "../../shared/src/pool.js";
import {
  claimPrizeForOwner,
  inspectClaim,
  type ClaimResult,
} from "../../wallet/src/claim-prize.js";
import { createKeeperRuntime } from "./runtime.js";
import {
  writeFinalizationRecord,
  type FinalizationSnapshot,
} from "./finalization-record.js";
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

function optionalArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

async function snapshot(
  programId: PublicKey,
  poolAddress: PublicKey,
  pool: RawPool,
  connection: Parameters<typeof getAccount>[0],
): Promise<FinalizationSnapshot> {
  const [vault] = deriveVaultPda(programId, poolAddress);
  const vaultAccount = await getAccount(connection, vault, "confirmed");
  const receipt = settlementReceipt(poolAddress, pool);
  return {
    status: poolStatus(pool),
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
    winners: receipt.winners,
    vaultAmount: vaultAccount.amount.toString(),
  };
}

async function main(): Promise<void> {
  const runtime = createKeeperRuntime();
  const poolAddress = new PublicKey(argument("--pool"));
  const ownerPaths = repeatedArguments("--owner-keypair").map((value) => path.resolve(value));
  const recordPath = optionalArgument("--record");
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
  const checkpoint = async (): Promise<void> => {
    if (!recordPath) return;
    pool = await fetchPool(runtime.program, poolAddress);
    writeFinalizationRecord(recordPath, {
      pool: poolAddress.toBase58(),
      recordedAt: new Date().toISOString(),
      settlement,
      claims,
      skipped,
      snapshot: await snapshot(
        runtime.program.programId,
        poolAddress,
        pool,
        runtime.program.provider.connection,
      ),
    });
  };
  await checkpoint();
  for (const ownerPath of ownerPaths) {
    const owner = readKeypair(ownerPath);
    const entryCount = bnNumber(pool.entryCount, "entryCount");
    const participant = (pool.entries as Array<{ owner: PublicKey }>)
      .slice(0, entryCount)
      .some((entry) => entry.owner.equals(owner.publicKey));
    if (!participant) {
      skipped.push({ owner: owner.publicKey.toBase58(), reason: "no-position" });
      await checkpoint();
      continue;
    }
    const inspected = await inspectClaim({
      program: runtime.program,
      owner: owner.publicKey,
      poolAddress,
    });
    if (!inspected.eligibility.eligible) {
      skipped.push({ owner: owner.publicKey.toBase58(), reason: inspected.eligibility.reason });
      await checkpoint();
      continue;
    }
    claims.push(await claimPrizeForOwner({ program: runtime.program, owner, poolAddress }));
    await checkpoint();
  }
  await checkpoint();
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
