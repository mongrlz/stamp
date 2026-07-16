import { Program } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import {
  derivePositionPda,
  deriveVaultPda,
} from "../../../packages/stamp-sdk/src/pdas.js";
import { bnNumber, poolStatus, type RawPool } from "../../shared/src/pool.js";

export type RawPosition = {
  pool: PublicKey;
  owner: PublicKey;
  entryIndex: number;
  paid: boolean;
};

export type ClaimEligibility = {
  eligible: boolean;
  entryIndex: number;
  reason: "eligible" | "not-settled" | "already-paid" | "not-winner";
};

export type ClaimResult = {
  signature: string;
  pool: string;
  winner: string;
  position: string;
  winnerTokens: string;
  entryIndex: number;
  amount: string;
};

function bnBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (BN.isBN(value)) {
    const text = (value as BN).toString(10);
    if (!text.startsWith("-")) return BigInt(text);
  }
  throw new Error(`Pool field ${field} is not a nonnegative integer`);
}

export function claimEligibility(pool: RawPool, position: RawPosition): ClaimEligibility {
  const entryIndex = bnNumber(position.entryIndex, "position.entryIndex");
  if (entryIndex < 0 || entryIndex >= 16) {
    throw new Error("Position entry index must fit the pool winner mask");
  }
  if (poolStatus(pool) !== "settled") {
    return { eligible: false, entryIndex, reason: "not-settled" };
  }
  if (position.paid) {
    return { eligible: false, entryIndex, reason: "already-paid" };
  }
  const winnerMask = bnNumber(pool.winnerMask ?? 0, "winnerMask");
  if ((winnerMask & (1 << entryIndex)) === 0) {
    return { eligible: false, entryIndex, reason: "not-winner" };
  }
  return { eligible: true, entryIndex, reason: "eligible" };
}

export function nextClaimAmount(pool: RawPool): bigint {
  const winnerCount = bnNumber(pool.winnerCount, "winnerCount");
  const winnersClaimed = bnNumber(pool.winnersClaimed, "winnersClaimed");
  if (winnerCount <= 0 || winnersClaimed < 0 || winnersClaimed >= winnerCount) {
    throw new Error("Pool winner counters do not permit another claim");
  }
  const prizeTotal = bnBigInt(pool.prizeTotal, "prizeTotal");
  const claimedTotal = bnBigInt(pool.claimedTotal, "claimedTotal");
  if (claimedTotal > prizeTotal) throw new Error("Pool claimed total exceeds its prize total");
  return winnersClaimed + 1 === winnerCount
    ? prizeTotal - claimedTotal
    : prizeTotal / BigInt(winnerCount);
}

async function fetchPool(program: Program, address: PublicKey): Promise<RawPool> {
  return (program.account as unknown as {
    pool: { fetch(value: PublicKey): Promise<RawPool> };
  }).pool.fetch(address);
}

async function fetchPosition(program: Program, address: PublicKey): Promise<RawPosition> {
  return (program.account as unknown as {
    position: { fetch(value: PublicKey): Promise<RawPosition> };
  }).position.fetch(address);
}

export async function inspectClaim(options: {
  program: Program;
  owner: PublicKey;
  poolAddress: PublicKey;
}): Promise<{
  pool: RawPool;
  position: RawPosition;
  positionAddress: PublicKey;
  eligibility: ClaimEligibility;
}> {
  const pool = await fetchPool(options.program, options.poolAddress);
  const [positionAddress] = derivePositionPda(
    options.program.programId,
    options.poolAddress,
    options.owner,
  );
  const position = await fetchPosition(options.program, positionAddress);
  if (!position.pool.equals(options.poolAddress) || !position.owner.equals(options.owner)) {
    throw new Error("Position ownership does not match the requested pool and wallet");
  }
  return {
    pool,
    position,
    positionAddress,
    eligibility: claimEligibility(pool, position),
  };
}

export async function claimPrizeForOwner(options: {
  program: Program;
  owner: Keypair;
  poolAddress: PublicKey;
}): Promise<ClaimResult> {
  const inspected = await inspectClaim({
    program: options.program,
    owner: options.owner.publicKey,
    poolAddress: options.poolAddress,
  });
  if (!inspected.eligibility.eligible) {
    throw new Error(`Prize is not claimable: ${inspected.eligibility.reason}`);
  }
  const tokenProgram = new PublicKey(inspected.pool.tokenProgram as PublicKey);
  if (!tokenProgram.equals(TOKEN_PROGRAM_ID)) {
    throw new Error("STAMP claim CLI only supports the standard SPL Token program");
  }
  const mint = new PublicKey(inspected.pool.mint as PublicKey);
  const [vault] = deriveVaultPda(options.program.programId, options.poolAddress);
  const winnerTokens = await getOrCreateAssociatedTokenAccount(
    options.program.provider.connection,
    options.owner,
    mint,
    options.owner.publicKey,
    false,
    "confirmed",
    undefined,
    tokenProgram,
  );
  const amount = nextClaimAmount(inspected.pool);
  const signature = await (options.program.methods as unknown as {
    claimPrize(): {
      accounts(value: Record<string, PublicKey>): {
        signers(value: Keypair[]): { rpc(): Promise<string> };
      };
    };
  }).claimPrize().accounts({
    winner: options.owner.publicKey,
    pool: options.poolAddress,
    position: inspected.positionAddress,
    vault,
    winnerTokens: winnerTokens.address,
    mint,
    tokenProgram,
  }).signers([options.owner]).rpc();

  const after = await inspectClaim({
    program: options.program,
    owner: options.owner.publicKey,
    poolAddress: options.poolAddress,
  });
  if (!after.position.paid) throw new Error("Claim transaction confirmed but position is not paid");
  return {
    signature,
    pool: options.poolAddress.toBase58(),
    winner: options.owner.publicKey.toBase58(),
    position: inspected.positionAddress.toBase58(),
    winnerTokens: winnerTokens.address.toBase58(),
    entryIndex: inspected.eligibility.entryIndex,
    amount: amount.toString(),
  };
}
