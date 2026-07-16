import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";

import {
  derivePoolPda,
  derivePositionPda,
  deriveVaultPda,
} from "../../../packages/stamp-sdk/src/pdas.js";
import stampIdl from "../../../packages/stamp-sdk/src/idl/stamp.json" with { type: "json" };
import type { MatchFingerprint } from "../../../packages/txline/src/replay.js";
import { walletPoolAction, type BrowserPosition } from "./stamp-state.js";
import type { PublicPool } from "./types.js";

export const STAMP_PROGRAM_ID = new PublicKey("7Xh5gJZN2SoYmDLsVQKtqFoB8pxrvykn9S8hjFWguE5o");

export type CreatePoolInput = {
  poolId: bigint;
  fixtureId: number;
  entryFee: bigint;
  maxEntries: number;
  cutoffAt: number;
  settleAfter: number;
  refundAfter: number;
  mint: PublicKey;
};

type MethodBuilder = {
  accounts(value: Record<string, PublicKey>): {
    instruction(): Promise<TransactionInstruction>;
  };
};

type StampMethods = {
  createPool(args: Record<string, unknown>): MethodBuilder;
  enterPool(values: MatchFingerprint): MethodBuilder;
  claimPrize(): MethodBuilder;
  refundEntry(): MethodBuilder;
};

function methods(program: Program): StampMethods {
  return program.methods as unknown as StampMethods;
}

function standardTokenProgram(value: string | PublicKey): PublicKey {
  const tokenProgram = new PublicKey(value);
  if (!tokenProgram.equals(TOKEN_PROGRAM_ID)) {
    throw new Error("STAMP browser actions support standard SPL Token pools only");
  }
  return tokenProgram;
}

export function createBrowserProgram(
  connection: Connection,
  wallet: ConstructorParameters<typeof AnchorProvider>[1],
): Program {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new Program(stampIdl as Idl, provider);
  if (!program.programId.equals(STAMP_PROGRAM_ID)) {
    throw new Error("Committed STAMP IDL does not match the devnet program");
  }
  return program;
}

export async function fetchWalletPosition(
  program: Program,
  pool: PublicKey,
  owner: PublicKey,
): Promise<BrowserPosition | null> {
  const [position] = derivePositionPda(program.programId, pool, owner);
  return (program.account as unknown as {
    position: { fetchNullable(address: PublicKey): Promise<BrowserPosition | null> };
  }).position.fetchNullable(position);
}

export async function buildCreatePoolInstruction(
  program: Program,
  creator: PublicKey,
  input: CreatePoolInput,
): Promise<{ instruction: TransactionInstruction; pool: PublicKey; vault: PublicKey }> {
  standardTokenProgram(TOKEN_PROGRAM_ID);
  const [pool] = derivePoolPda(program.programId, creator, input.poolId);
  const [vault] = deriveVaultPda(program.programId, pool);
  const instruction = await methods(program).createPool({
    poolId: new BN(input.poolId.toString()),
    fixtureId: new BN(input.fixtureId),
    entryFee: new BN(input.entryFee.toString()),
    maxEntries: input.maxEntries,
    cutoffAt: new BN(input.cutoffAt),
    settleAfter: new BN(input.settleAfter),
    refundAfter: new BN(input.refundAfter),
  }).accounts({
    creator,
    pool,
    vault,
    mint: input.mint,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  }).instruction();
  return { instruction, pool, vault };
}

export async function buildEnterPoolInstruction(
  program: Program,
  pool: PublicPool,
  owner: PublicKey,
  values: MatchFingerprint,
): Promise<{ instruction: TransactionInstruction; position: PublicKey; ownerTokens: PublicKey }> {
  const poolAddress = new PublicKey(pool.address);
  const mint = new PublicKey(pool.mint);
  const tokenProgram = standardTokenProgram(pool.tokenProgram);
  const [position] = derivePositionPda(program.programId, poolAddress, owner);
  const [vault] = deriveVaultPda(program.programId, poolAddress);
  const ownerTokens = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
  const instruction = await methods(program).enterPool(values).accounts({
    owner,
    pool: poolAddress,
    position,
    ownerTokens,
    vault,
    mint,
    tokenProgram,
    systemProgram: SystemProgram.programId,
  }).instruction();
  return { instruction, position, ownerTokens };
}

async function payoutInstruction(
  program: Program,
  pool: PublicPool,
  owner: PublicKey,
  action: "claim" | "refund",
): Promise<{ instruction: TransactionInstruction; position: PublicKey; ownerTokens: PublicKey }> {
  const poolAddress = new PublicKey(pool.address);
  const mint = new PublicKey(pool.mint);
  const tokenProgram = standardTokenProgram(pool.tokenProgram);
  const [position] = derivePositionPda(program.programId, poolAddress, owner);
  const [vault] = deriveVaultPda(program.programId, poolAddress);
  const ownerTokens = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
  const accounts = {
    [action === "claim" ? "winner" : "owner"]: owner,
    pool: poolAddress,
    position,
    vault,
    [action === "claim" ? "winnerTokens" : "ownerTokens"]: ownerTokens,
    mint,
    tokenProgram,
  };
  const instruction = await (action === "claim"
    ? methods(program).claimPrize()
    : methods(program).refundEntry()
  ).accounts(accounts).instruction();
  return { instruction, position, ownerTokens };
}

export function buildClaimPrizeInstruction(program: Program, pool: PublicPool, owner: PublicKey) {
  return payoutInstruction(program, pool, owner, "claim");
}

export function buildRefundEntryInstruction(program: Program, pool: PublicPool, owner: PublicKey) {
  return payoutInstruction(program, pool, owner, "refund");
}

async function sendWithOptionalAta(
  program: Program,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey,
  ownerTokens: PublicKey,
  instruction: TransactionInstruction,
  createAta: boolean,
): Promise<string> {
  const transaction = new Transaction();
  if (createAta) {
    transaction.add(createAssociatedTokenAccountInstruction(
      owner,
      ownerTokens,
      owner,
      mint,
      tokenProgram,
    ));
  }
  transaction.add(instruction);
  return (program.provider as AnchorProvider).sendAndConfirm(transaction, [], {
    commitment: "confirmed",
  });
}

export async function enterPool(
  program: Program,
  pool: PublicPool,
  owner: PublicKey,
  values: MatchFingerprint,
): Promise<string> {
  if (walletPoolAction(pool, owner, null) !== "enter") {
    throw new Error("This wallet cannot enter the pool in its current state");
  }
  const built = await buildEnterPoolInstruction(program, pool, owner, values);
  if (!await program.provider.connection.getAccountInfo(built.ownerTokens, "confirmed")) {
    throw new Error("Wallet has no funded test-USDT token account for this pool");
  }
  return sendWithOptionalAta(
    program,
    owner,
    new PublicKey(pool.mint),
    TOKEN_PROGRAM_ID,
    built.ownerTokens,
    built.instruction,
    false,
  );
}

export async function claimPrize(
  program: Program,
  pool: PublicPool,
  owner: PublicKey,
): Promise<string> {
  const position = await fetchWalletPosition(program, new PublicKey(pool.address), owner);
  if (walletPoolAction(pool, owner, position) !== "claim") {
    throw new Error("This wallet does not have a claimable STAMP receipt");
  }
  const built = await buildClaimPrizeInstruction(program, pool, owner);
  const createAta = !await program.provider.connection.getAccountInfo(built.ownerTokens, "confirmed");
  return sendWithOptionalAta(program, owner, new PublicKey(pool.mint), TOKEN_PROGRAM_ID, built.ownerTokens, built.instruction, createAta);
}

export async function refundEntry(
  program: Program,
  pool: PublicPool,
  owner: PublicKey,
): Promise<string> {
  const position = await fetchWalletPosition(program, new PublicKey(pool.address), owner);
  if (walletPoolAction(pool, owner, position) !== "refund") {
    throw new Error("This wallet does not have a refundable STAMP receipt");
  }
  const built = await buildRefundEntryInstruction(program, pool, owner);
  const createAta = !await program.provider.connection.getAccountInfo(built.ownerTokens, "confirmed");
  return sendWithOptionalAta(program, owner, new PublicKey(pool.mint), TOKEN_PROGRAM_ID, built.ownerTokens, built.instruction, createAta);
}
