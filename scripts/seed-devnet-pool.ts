import fs from "node:fs";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
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

const STAMP_PROGRAM = new PublicKey("7Xh5gJZN2SoYmDLsVQKtqFoB8pxrvykn9S8hjFWguE5o");
const DEVNET_USDT_MINT = new PublicKey("ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh");
const ENTRY_FEE = 1_000_000;

function keypair(filePath: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(filePath, "utf8")) as number[]));
}

async function main(): Promise<void> {
  const [authorityPath, entrantPath, fixtureText, kickoffText] = process.argv.slice(2);
  if (!authorityPath || !entrantPath || !fixtureText || !kickoffText) {
    throw new Error(
      "Usage: npm run devnet:seed-pool -- <AUTHORITY_JSON> <ENTRANT_JSON> <FIXTURE_ID> <KICKOFF_MS>",
    );
  }
  const fixtureId = Number.parseInt(fixtureText, 10);
  const kickoffMs = Number.parseInt(kickoffText, 10);
  if (!Number.isSafeInteger(fixtureId) || !Number.isSafeInteger(kickoffMs)) {
    throw new Error("Fixture id and kickoff must be safe integers");
  }
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

  const entrantFundingSignature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(SystemProgram.transfer({
      fromPubkey: creator.publicKey,
      toPubkey: entrant.publicKey,
      lamports: Math.floor(0.05 * LAMPORTS_PER_SOL),
    })),
    [creator],
    { commitment: "confirmed" },
  );
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
  const tokenFundingSignature = await transfer(
    connection,
    creator,
    creatorTokens.address,
    entrantTokens.address,
    creator,
    3 * ENTRY_FEE,
  );

  const poolId = BigInt(fixtureId);
  const [pool] = derivePoolPda(program.programId, creator.publicKey, poolId);
  const [vault] = deriveVaultPda(program.programId, pool);
  const kickoff = Math.floor(kickoffMs / 1000);
  const cutoffAt = kickoff - 15 * 60;
  const settleAfter = kickoff + 4 * 60 * 60;
  const refundAfter = settleAfter + 24 * 60 * 60;
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
    fixture: "France vs England",
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
