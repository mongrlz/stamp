import fs from "node:fs";
import nodeAssert from "node:assert/strict";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import { getAccount } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { derivePositionPda, deriveVaultPda } from "../packages/stamp-sdk/src/pdas.js";
import { publicPool, settlementReceipt } from "../services/shared/src/pool.js";

const RPC = "https://api.devnet.solana.com";

type DeploymentRecord = {
  program: { address: string };
  livePool: {
    status: string;
    pool: string;
    vault: string;
    fixtureId: number;
    mint?: string;
    entryFee: number;
    cutoff: string;
    settleAfter: string;
    refundAfter: string;
    entries: Array<{
      owner: string;
      position: string;
      forecast: number[];
    }>;
    transactions: Record<string, unknown>;
    finalization?: { complete?: boolean };
  };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function timestampSeconds(value: string, field: string): number {
  const milliseconds = Date.parse(value);
  assert(Number.isSafeInteger(milliseconds), `Recorded ${field} is not an ISO timestamp`);
  assert(milliseconds % 1_000 === 0, `Recorded ${field} must have whole-second precision`);
  return milliseconds / 1_000;
}

function transactionSignatures(transactions: Record<string, unknown>): string[] {
  const signatures: string[] = [];
  for (const value of Object.values(transactions)) {
    if (typeof value === "string") {
      signatures.push(value);
      continue;
    }
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (item && typeof item === "object" && typeof (item as { signature?: unknown }).signature === "string") {
        signatures.push((item as { signature: string }).signature);
      }
    }
  }
  return [...new Set(signatures)];
}

async function main(): Promise<void> {
  const recordPath = process.argv[2] ?? "deployments/devnet.json";
  const deployment = JSON.parse(fs.readFileSync(recordPath, "utf8")) as DeploymentRecord;
  const programAddress = new PublicKey(deployment.program.address);
  const poolAddress = new PublicKey(deployment.livePool.pool);
  const recordedVault = new PublicKey(deployment.livePool.vault);
  const [vaultAddress] = deriveVaultPda(programAddress, poolAddress);
  assert(vaultAddress.equals(recordedVault), "Recorded vault does not match the pool PDA");

  const connection = new Connection(RPC, "confirmed");
  const readonlyWallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(connection, readonlyWallet, { commitment: "confirmed" });
  const idl = JSON.parse(fs.readFileSync("target/idl/stamp.json", "utf8")) as Idl;
  const program = new Program(idl, provider);
  assert(
    program.programId.equals(programAddress),
    "Local IDL does not point at the deployed STAMP program",
  );
  const programAccount = await connection.getAccountInfo(programAddress, "confirmed");
  assert(programAccount?.executable, "STAMP program is not executable on devnet");
  const pool = await (program.account as unknown as {
    pool: { fetch(address: PublicKey): Promise<Record<string, any>> };
  }).pool.fetch(poolAddress);
  const vault = await getAccount(connection, vaultAddress, "confirmed");

  const status = Object.keys(pool.status)[0];
  assert(status === "locked" || status === "settled", `Unexpected live pool status: ${status}`);
  assert(pool.entryCount === 2 && pool.maxEntries === 2, "Live pool entry count is wrong");
  assert(
    (pool.fixtureId as BN).toNumber() === deployment.livePool.fixtureId,
    "Live pool fixture id is wrong",
  );
  assert(
    (pool.entryFee as BN).toNumber() === deployment.livePool.entryFee,
    "Live pool entry fee does not match the deployment record",
  );
  assert(
    (pool.cutoffAt as BN).toNumber() === timestampSeconds(deployment.livePool.cutoff, "cutoff"),
    "Live pool cutoff does not match the deployment record",
  );
  assert(
    (pool.settleAfter as BN).toNumber()
      === timestampSeconds(deployment.livePool.settleAfter, "settleAfter"),
    "Live pool settlement time does not match the deployment record",
  );
  assert(
    (pool.refundAfter as BN).toNumber()
      === timestampSeconds(deployment.livePool.refundAfter, "refundAfter"),
    "Live pool refund time does not match the deployment record",
  );
  if (deployment.livePool.mint) {
    assert(
      (pool.mint as PublicKey).equals(new PublicKey(deployment.livePool.mint)),
      "Live pool mint does not match the deployment record",
    );
  }
  assert(vault.owner.equals(poolAddress), "Vault is not owned by the Pool PDA");
  assert(
    deployment.livePool.entries.length === pool.entryCount,
    "Recorded entry count does not match the Pool account",
  );

  const verifiedPositions: Array<{ owner: string; position: string; forecast: number[] }> = [];
  for (const [index, recorded] of deployment.livePool.entries.entries()) {
    const owner = new PublicKey(recorded.owner);
    const recordedPosition = new PublicKey(recorded.position);
    const [derivedPosition] = derivePositionPda(programAddress, poolAddress, owner);
    assert(derivedPosition.equals(recordedPosition), `Position ${index} is not canonical`);
    const chainEntry = pool.entries[index] as {
      owner: PublicKey;
      values: number[];
      occupied: boolean;
    };
    assert(chainEntry.occupied, `Pool entry ${index} is not occupied`);
    assert(chainEntry.owner.equals(owner), `Pool entry ${index} owner does not match the record`);
    nodeAssert.deepEqual(chainEntry.values, recorded.forecast, `Pool entry ${index} forecast mismatch`);
    const position = await (program.account as unknown as {
      position: { fetch(address: PublicKey): Promise<Record<string, any>> };
    }).position.fetch(derivedPosition);
    assert((position.pool as PublicKey).equals(poolAddress), `Position ${index} pool mismatch`);
    assert((position.owner as PublicKey).equals(owner), `Position ${index} owner mismatch`);
    assert(position.entryIndex === index, `Position ${index} index mismatch`);
    nodeAssert.deepEqual(position.values, recorded.forecast, `Position ${index} forecast mismatch`);
    verifiedPositions.push({
      owner: owner.toBase58(),
      position: derivedPosition.toBase58(),
      forecast: position.values,
    });
  }

  const signatures = transactionSignatures(deployment.livePool.transactions);
  assert(signatures.length > 0, "Deployment record contains no transaction signatures");
  const statuses = await connection.getSignatureStatuses(signatures, {
    searchTransactionHistory: true,
  });
  statuses.value.forEach((signatureStatus, index) => {
    assert(signatureStatus, `Recorded transaction ${signatures[index]} was not found on devnet`);
    assert(signatureStatus.err === null, `Recorded transaction ${signatures[index]} failed on devnet`);
    assert(
      signatureStatus.confirmationStatus === "confirmed"
        || signatureStatus.confirmationStatus === "finalized",
      `Recorded transaction ${signatures[index]} is not confirmed`,
    );
  });

  const expectedPrize = BigInt(deployment.livePool.entryFee * pool.entryCount);
  if (status === "locked") {
    assert(vault.amount === expectedPrize, "Locked vault does not contain the recorded entry fees");
  } else {
    const prizeTotal = BigInt((pool.prizeTotal as BN).toString());
    const claimedTotal = BigInt((pool.claimedTotal as BN).toString());
    assert(prizeTotal === expectedPrize, "Settled prize total does not match the recorded entries");
    assert(claimedTotal <= prizeTotal, "Claimed total exceeds the settled prize");
    assert(vault.amount === prizeTotal - claimedTotal, "Vault balance does not match unclaimed prize");
    assert(pool.winnerMask > 0 && pool.winnerCount > 0, "Settled pool has no winner");
  }
  if (deployment.livePool.finalization?.complete) {
    assert(status === "settled", "Completed finalization record points to an unsettled pool");
    assert(vault.amount === 0n, "Completed finalization record has funds left in the vault");
    assert(
      (pool.claimedTotal as BN).eq(pool.prizeTotal as BN),
      "Completed finalization record has an unpaid prize balance",
    );
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    record: recordPath,
    program: programAddress.toBase58(),
    programExecutable: programAccount.executable,
    pool: poolAddress.toBase58(),
    status,
    fixtureId: (pool.fixtureId as BN).toString(),
    entries: pool.entries.slice(0, pool.entryCount).map((entry: any) => ({
      owner: entry.owner.toBase58(),
      forecast: entry.values,
    })),
    vault: vaultAddress.toBase58(),
    vaultOwner: vault.owner.toBase58(),
    vaultAmount: vault.amount.toString(),
    verifiedPositions,
    verifiedTransactions: signatures,
    poolState: publicPool(poolAddress, pool),
    settlement: settlementReceipt(poolAddress, pool),
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
