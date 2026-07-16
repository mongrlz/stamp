import assert from "node:assert/strict";
import fs from "node:fs";
import { AnchorProvider, type Idl, Program, Wallet } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import BN from "bn.js";

import { derivePoolPda, derivePositionPda, deriveVaultPda } from "../packages/stamp-sdk/src/pdas.js";
import { deriveDailyScoresRoot } from "../packages/txline/src/proof.js";

const STAMP_PROGRAM = new PublicKey("7Xh5gJZN2SoYmDLsVQKtqFoB8pxrvykn9S8hjFWguE5o");
const MOCK_TXLINE_PROGRAM = new PublicKey("8xo4Evfg7dcWjbYVcXZSbScqbWvGhjgSpaJzbiKrQX7m");
const ENTRY_FEE = 1_000_000n;

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const programAccount = (program: Program, name: string) =>
  (program.account as unknown as Record<string, { fetch(address: PublicKey): Promise<Record<string, unknown>> }>)[name]!;
const methods = (program: Program) => program.methods as unknown as Record<string, (...args: unknown[]) => any>;

async function main(): Promise<void> {
  const provider = AnchorProvider.env();
  const payer = (provider.wallet as Wallet).payer;
  const stampIdl = JSON.parse(fs.readFileSync("target/idl/stamp.json", "utf8")) as Idl;
  const mockIdl = JSON.parse(fs.readFileSync("target/idl/mock_txline.json", "utf8")) as Idl;
  const stamp = new Program(stampIdl, provider);
  const mock = new Program(mockIdl, provider);
  assert(stamp.programId.equals(STAMP_PROGRAM));
  assert(mock.programId.equals(MOCK_TXLINE_PROGRAM));

  const mint = await createMint(provider.connection, payer, payer.publicKey, null, 6);
  const entrants = [Keypair.generate(), Keypair.generate(), Keypair.generate(), Keypair.generate()];
  for (const entrant of entrants) {
    const signature = await provider.connection.requestAirdrop(entrant.publicKey, LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(signature, "confirmed");
  }
  const tokenAccounts = [];
  for (const entrant of entrants) {
    const account = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      entrant.publicKey,
    );
    await mintTo(provider.connection, payer, mint, account.address, payer, 10_000_000n);
    tokenAccounts.push(account.address);
  }

  const now = Math.floor(Date.now() / 1000);
  const cutoffAt = now + 8;
  const settleAfter = now + 10;
  const refundAfter = now + 30;
  const fixtureId = 99_000_001;
  const poolId = BigInt(Date.now());
  const [pool] = derivePoolPda(stamp.programId, payer.publicKey, poolId);
  const [vault] = deriveVaultPda(stamp.programId, pool);

  await methods(stamp).createPool({
    poolId: new BN(poolId.toString()),
    fixtureId: new BN(fixtureId),
    entryFee: new BN(ENTRY_FEE.toString()),
    maxEntries: 3,
    cutoffAt: new BN(cutoffAt),
    settleAfter: new BN(settleAfter),
    refundAfter: new BN(refundAfter),
  }).accounts({
    creator: payer.publicKey,
    pool,
    vault,
    mint,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  }).rpc();

  const forecasts: [number, number, number, number][] = [
    [2, 1, 4, 4],
    [2, 1, 6, 4],
    [3, 1, 5, 4],
  ];
  for (let index = 0; index < 3; index += 1) {
    const owner = entrants[index]!;
    const [position] = derivePositionPda(stamp.programId, pool, owner.publicKey);
    await methods(stamp).enterPool(forecasts[index]).accounts({
      owner: owner.publicKey,
      pool,
      position,
      ownerTokens: tokenAccounts[index],
      vault,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    }).signers([owner]).rpc();
  }

  const locked = await programAccount(stamp, "pool").fetch(pool);
  assert.deepEqual(locked.status, { locked: {} });
  assert.equal(locked.entryCount, 3);
  assert.equal((await getAccount(provider.connection, vault)).amount, 3n * ENTRY_FEE);

  // Build an underfilled pool now so it can take the refund branch after the same cutoff.
  const refundPoolId = poolId + 1n;
  const [refundPool] = derivePoolPda(stamp.programId, payer.publicKey, refundPoolId);
  const [refundVault] = deriveVaultPda(stamp.programId, refundPool);
  await methods(stamp).createPool({
    poolId: new BN(refundPoolId.toString()),
    fixtureId: new BN(fixtureId + 1),
    entryFee: new BN(ENTRY_FEE.toString()),
    maxEntries: 2,
    cutoffAt: new BN(cutoffAt),
    settleAfter: new BN(settleAfter),
    refundAfter: new BN(refundAfter),
  }).accounts({
    creator: payer.publicKey,
    pool: refundPool,
    vault: refundVault,
    mint,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  }).rpc();
  const refundOwner = entrants[3]!;
  const [refundPosition] = derivePositionPda(stamp.programId, refundPool, refundOwner.publicKey);
  await methods(stamp).enterPool([1, 1, 1, 1]).accounts({
    owner: refundOwner.publicKey,
    pool: refundPool,
    position: refundPosition,
    ownerTokens: tokenAccounts[3],
    vault: refundVault,
    mint,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  }).signers([refundOwner]).rpc();

  await sleep(12_000);
  const proofTimestamp = Date.now();
  const [oracleRoots] = deriveDailyScoresRoot(mock.programId, proofTimestamp);
  const epochDay = Math.floor(proofTimestamp / 86_400_000);
  await methods(mock).initializeDailyRoot(epochDay).accounts({
    payer: payer.publicKey,
    dailyScoresRoots: oracleRoots,
    systemProgram: SystemProgram.programId,
  }).rpc();

  const emptyHash = Array.from({ length: 32 }, () => 0);
  const proof = {
    ts: new BN(proofTimestamp),
    fixtureSummary: {
      fixtureId: new BN(fixtureId),
      updateStats: {
        updateCount: 1,
        minTimestamp: new BN(proofTimestamp),
        maxTimestamp: new BN(proofTimestamp),
      },
      eventsSubTreeRoot: emptyHash,
    },
    fixtureProof: [],
    mainTreeProof: [],
    eventStatRoot: emptyHash,
    leafValues: [2, 1, 5, 4],
    multiproofHashes: [],
    leafIndices: [0, 1, 2, 3],
  };
  await methods(stamp).settlePool(proof).accounts({
    cranker: payer.publicKey,
    pool,
    oracleProgram: mock.programId,
    oracleRoots,
  }).rpc();

  const settled = await programAccount(stamp, "pool").fetch(pool);
  assert.deepEqual(settled.status, { settled: {} });
  assert.deepEqual(settled.finalVector, [2, 1, 5, 4]);
  assert.equal(settled.winnerMask, 0b0011);
  assert.equal(settled.winnerCount, 2);
  assert.equal(settled.winningDistance, 1);
  assert.equal((settled.prizeTotal as BN).toString(), (3n * ENTRY_FEE).toString());

  for (let index = 0; index < 2; index += 1) {
    const winner = entrants[index]!;
    const [position] = derivePositionPda(stamp.programId, pool, winner.publicKey);
    await methods(stamp).claimPrize().accounts({
      winner: winner.publicKey,
      pool,
      position,
      vault,
      winnerTokens: tokenAccounts[index],
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([winner]).rpc();
  }
  assert.equal((await getAccount(provider.connection, vault)).amount, 0n);
  assert.equal((await getAccount(provider.connection, tokenAccounts[0]!)).amount, 10_500_000n);
  assert.equal((await getAccount(provider.connection, tokenAccounts[1]!)).amount, 10_500_000n);
  assert.equal((await getAccount(provider.connection, tokenAccounts[2]!)).amount, 9_000_000n);

  await methods(stamp).markRefundable().accounts({
    actor: payer.publicKey,
    pool: refundPool,
  }).rpc();
  await methods(stamp).refundEntry().accounts({
    owner: refundOwner.publicKey,
    pool: refundPool,
    position: refundPosition,
    vault: refundVault,
    ownerTokens: tokenAccounts[3],
    mint,
    tokenProgram: TOKEN_PROGRAM_ID,
  }).signers([refundOwner]).rpc();
  assert.equal((await getAccount(provider.connection, refundVault)).amount, 0n);
  assert.equal((await getAccount(provider.connection, tokenAccounts[3]!)).amount, 10_000_000n);

  process.stdout.write("STAMP local integration passed: escrow, 3 entries, v3 CPI, tie claims, and refund.\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
