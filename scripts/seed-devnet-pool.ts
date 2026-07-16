import fs from "node:fs";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  transfer,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import BN from "bn.js";

import { derivePoolPda, derivePositionPda, deriveVaultPda } from "../packages/stamp-sdk/src/pdas.js";
import { planLivePoolTiming } from "../services/shared/src/live-pool-timing.js";

const STAMP_PROGRAM = new PublicKey("7Xh5gJZN2SoYmDLsVQKtqFoB8pxrvykn9S8hjFWguE5o");
const DEVNET_USDT_MINT = new PublicKey("ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh");
const ENTRY_FEE = 1_000_000;
const ENTRANT_SOL_TARGET = Math.floor(0.05 * LAMPORTS_PER_SOL);

function keypair(filePath: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(filePath, "utf8")) as number[]));
}

async function main(): Promise<void> {
  const [authorityPath, entrantPath, fixtureText, kickoffText, fixtureName] = process.argv.slice(2);
  if (!authorityPath || !entrantPath || !fixtureText || !kickoffText) {
    throw new Error(
      "Usage: npm run devnet:seed-pool -- <AUTHORITY_JSON> <ENTRANT_JSON> <FIXTURE_ID> <KICKOFF_MS> [FIXTURE_NAME]",
    );
  }
  const fixtureId = Number.parseInt(fixtureText, 10);
  const kickoffMs = Number.parseInt(kickoffText, 10);
  if (!Number.isSafeInteger(fixtureId) || !Number.isSafeInteger(kickoffMs)) {
    throw new Error("Fixture id and kickoff must be safe integers");
  }
  // Reject unsafe fixture timing before reading balances or sending any funding.
  planLivePoolTiming({ nowMs: Date.now(), kickoffMs });
  const creator = keypair(authorityPath);
  const entrant = keypair(entrantPath);
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(creator), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const idl = JSON.parse(fs.readFileSync("target/idl/stamp.json", "utf8")) as Idl;
  const program = new Program(idl, provider);
  if (!program.programId.equals(STAMP_PROGRAM)) throw new Error("STAMP IDL address mismatch");
  const poolId = BigInt(fixtureId);
  const [pool] = derivePoolPda(program.programId, creator.publicKey, poolId);
  const [vault] = deriveVaultPda(program.programId, pool);
  if (await connection.getAccountInfo(pool, "confirmed")) {
    throw new Error(`Pool ${pool.toBase58()} already exists for fixture ${fixtureId}`);
  }

  const entrantBalance = await connection.getBalance(entrant.publicKey, "confirmed");
  const entrantFundingSignature = entrantBalance < ENTRANT_SOL_TARGET
    ? await sendAndConfirmTransaction(
        connection,
        new Transaction().add(SystemProgram.transfer({
          fromPubkey: creator.publicKey,
          toPubkey: entrant.publicKey,
          lamports: ENTRANT_SOL_TARGET - entrantBalance,
        })),
        [creator],
        { commitment: "confirmed" },
      )
    : null;
  const creatorTokens = await getOrCreateAssociatedTokenAccount(
    connection,
    creator,
    DEVNET_USDT_MINT,
    creator.publicKey,
  );
  const entrantTokens = await getOrCreateAssociatedTokenAccount(
    connection,
    creator,
    DEVNET_USDT_MINT,
    entrant.publicKey,
  );
  const entrantTokenBalance = (await getAccount(connection, entrantTokens.address, "confirmed")).amount;
  const entrantTokenTarget = BigInt(2 * ENTRY_FEE);
  const tokenFundingSignature = entrantTokenBalance < entrantTokenTarget
    ? await transfer(
        connection,
        creator,
        creatorTokens.address,
        entrantTokens.address,
        creator,
        entrantTokenTarget - entrantTokenBalance,
      )
    : null;

  const { cutoffAt, settleAfter, refundAfter } = planLivePoolTiming({
    nowMs: Date.now(),
    kickoffMs,
  });
  const methods = program.methods as unknown as Record<string, (...args: unknown[]) => any>;
  const createSignature = await methods.createPool({
    poolId: new BN(poolId.toString()),
    fixtureId: new BN(fixtureId),
    entryFee: new BN(ENTRY_FEE),
    maxEntries: 2,
    cutoffAt: new BN(cutoffAt),
    settleAfter: new BN(settleAfter),
    refundAfter: new BN(refundAfter),
  }).accounts({
    creator: creator.publicKey,
    pool,
    vault,
    mint: DEVNET_USDT_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  }).rpc();

  const [creatorPosition] = derivePositionPda(program.programId, pool, creator.publicKey);
  const creatorEntrySignature = await methods.enterPool([2, 1, 6, 4]).accounts({
    owner: creator.publicKey,
    pool,
    position: creatorPosition,
    ownerTokens: creatorTokens.address,
    vault,
    mint: DEVNET_USDT_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  }).rpc();
  const [entrantPosition] = derivePositionPda(program.programId, pool, entrant.publicKey);
  const entrantEntrySignature = await methods.enterPool([1, 1, 5, 5]).accounts({
    owner: entrant.publicKey,
    pool,
    position: entrantPosition,
    ownerTokens: entrantTokens.address,
    vault,
    mint: DEVNET_USDT_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  }).signers([entrant]).rpc();

  process.stdout.write(`${JSON.stringify({
    program: program.programId.toBase58(),
    fixtureId,
    fixture: fixtureName ?? `TxLINE fixture ${fixtureId}`,
    kickoffMs,
    poolId: poolId.toString(),
    pool: pool.toBase58(),
    vault: vault.toBase58(),
    mint: DEVNET_USDT_MINT.toBase58(),
    entryFee: ENTRY_FEE,
    cutoffAt,
    settleAfter,
    refundAfter,
    creator: creator.publicKey.toBase58(),
    creatorPosition: creatorPosition.toBase58(),
    creatorForecast: [2, 1, 6, 4],
    entrant: entrant.publicKey.toBase58(),
    entrantPosition: entrantPosition.toBase58(),
    entrantForecast: [1, 1, 5, 5],
    signatures: {
      entrantFunding: entrantFundingSignature,
      tokenFunding: tokenFundingSignature,
      createPool: createSignature,
      creatorEntry: creatorEntrySignature,
      entrantEntry: entrantEntrySignature,
    },
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
