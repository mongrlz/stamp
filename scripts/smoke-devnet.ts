import fs from "node:fs";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import { getAccount } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { deriveVaultPda } from "../packages/stamp-sdk/src/pdas.js";
import { publicPool, settlementReceipt } from "../services/shared/src/pool.js";

const RPC = "https://api.devnet.solana.com";

type DeploymentRecord = {
  program: { address: string };
  livePool: {
    pool: string;
    vault: string;
    fixtureId: number;
    entryFee: number;
  };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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
  assert(vault.owner.equals(poolAddress), "Vault is not owned by the Pool PDA");
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
    poolState: publicPool(poolAddress, pool),
    settlement: settlementReceipt(poolAddress, pool),
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
