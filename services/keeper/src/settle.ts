import fs from "node:fs";
import { AnchorProvider, type Idl, Program, Wallet } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";

import { TxLineClient } from "../../../packages/txline/src/client.js";
import { deriveDailyScoresRoot } from "../../../packages/txline/src/proof.js";
import { loadKeeperConfig } from "./config.js";
import { readKeypair } from "./keypair.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function statusName(value: unknown): string {
  if (!value || typeof value !== "object") return "unknown";
  return Object.keys(value as Record<string, unknown>)[0] ?? "unknown";
}

async function main(): Promise<void> {
  const poolArgument = argument("--pool");
  if (!poolArgument) throw new Error("Usage: npm run keeper:settle -- --pool <POOL_PUBKEY> [--seq <N>]");
  const requestedSequence = argument("--seq");
  const config = loadKeeperConfig();
  const keeper = readKeypair(config.keeperKeypairPath);
  const connection = new Connection(config.rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(keeper), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const idl = JSON.parse(fs.readFileSync(new URL("../../../target/idl/stamp.json", import.meta.url), "utf8")) as Idl;
  const program = new Program(idl, provider);
  const expectedProgram = new PublicKey(config.stampProgramId);
  if (!program.programId.equals(expectedProgram)) {
    throw new Error(`IDL program ${program.programId} does not match configured STAMP program ${expectedProgram}`);
  }

  const poolAddress = new PublicKey(poolArgument);
  const pool = await (program.account as unknown as {
    pool: { fetch(address: PublicKey): Promise<Record<string, unknown>> };
  }).pool.fetch(poolAddress);
  const status = statusName(pool.status);
  if (status !== "open" && status !== "locked") {
    throw new Error(`Pool is ${status}; settlement only accepts open or locked pools`);
  }
  const fixtureIdValue = pool.fixtureId;
  const fixtureId = typeof fixtureIdValue === "number"
    ? fixtureIdValue
    : BN.isBN(fixtureIdValue)
      ? (fixtureIdValue as BN).toNumber()
      : Number.NaN;
  if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
    throw new Error("Pool contains an invalid fixture id");
  }

  const txline = new TxLineClient(config.txline);
  const sequence = requestedSequence === undefined
    ? await txline.finalizedSequence(fixtureId)
    : Number.parseInt(requestedSequence, 10);
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("--seq must be a positive integer");
  const proof = await txline.stampProof(fixtureId, sequence);
  const oracleProgram = new PublicKey(config.oracleProgramId);
  const [oracleRoots] = deriveDailyScoresRoot(oracleProgram, proof.ts);

  const signature = await (program.methods as unknown as {
    settlePool(value: typeof proof): {
      accounts(value: Record<string, PublicKey>): {
        signers(value: typeof keeper[]): { rpc(): Promise<string> };
      };
    };
  })
    .settlePool(proof)
    .accounts({
      cranker: keeper.publicKey,
      pool: poolAddress,
      oracleProgram,
      oracleRoots,
    })
    .signers([keeper])
    .rpc();

  process.stdout.write(`${JSON.stringify({
    signature,
    pool: poolAddress.toBase58(),
    fixtureId,
    sequence,
    finalVector: proof.leafValues,
    oracleRoots: oracleRoots.toBase58(),
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
