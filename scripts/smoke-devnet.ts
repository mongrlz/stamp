import fs from "node:fs";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import { getAccount } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

const RPC = "https://api.devnet.solana.com";
const PROGRAM = new PublicKey("7Xh5gJZN2SoYmDLsVQKtqFoB8pxrvykn9S8hjFWguE5o");
const POOL = new PublicKey("3TGEb7Bwc1AZ1qxhFpQQZfxop9PZyiHPtyTKNybEZGWH");
const VAULT = new PublicKey("B4XYBDpdyGK1YcqZCrRHBoXUQgpk3suSvBAKUrg5m4r9");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const connection = new Connection(RPC, "confirmed");
  const readonlyWallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(connection, readonlyWallet, { commitment: "confirmed" });
  const idl = JSON.parse(fs.readFileSync("target/idl/stamp.json", "utf8")) as Idl;
  const program = new Program(idl, provider);
  assert(program.programId.equals(PROGRAM), "Local IDL does not point at the deployed STAMP program");
  const programAccount = await connection.getAccountInfo(PROGRAM, "confirmed");
  assert(programAccount?.executable, "STAMP program is not executable on devnet");
  const pool = await (program.account as unknown as {
    pool: { fetch(address: PublicKey): Promise<Record<string, any>> };
  }).pool.fetch(POOL);
  const vault = await getAccount(connection, VAULT, "confirmed");

  assert(Object.keys(pool.status)[0] === "locked", "Live pool is not locked");
  assert(pool.entryCount === 2 && pool.maxEntries === 2, "Live pool entry count is wrong");
  assert((pool.fixtureId as BN).toNumber() === 18_257_865, "Live pool fixture id is wrong");
  assert(vault.owner.equals(POOL), "Vault is not owned by the Pool PDA");
  assert(vault.amount === 2_000_000n, "Vault does not contain exactly 2 test USDT");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    program: PROGRAM.toBase58(),
    programExecutable: programAccount.executable,
    pool: POOL.toBase58(),
    status: Object.keys(pool.status)[0],
    fixtureId: (pool.fixtureId as BN).toString(),
    entries: pool.entries.slice(0, pool.entryCount).map((entry: any) => ({
      owner: entry.owner.toBase58(),
      forecast: entry.values,
    })),
    vault: VAULT.toBase58(),
    vaultOwner: vault.owner.toBase58(),
    vaultAmount: vault.amount.toString(),
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
