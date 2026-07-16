import assert from "node:assert/strict";
import test from "node:test";
import { Wallet } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { SolanaSignTransaction } from "@solana/wallet-standard-features";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import type { WalletAccount } from "@wallet-standard/base";
import { StandardConnect } from "@wallet-standard/features";

import { derivePoolPda, derivePositionPda, deriveVaultPda } from "../packages/stamp-sdk/src/pdas.js";
import {
  STAMP_PROGRAM_ID,
  buildClaimPrizeInstruction,
  buildCreatePoolInstruction,
  buildEnterPoolInstruction,
  buildRefundEntryInstruction,
  createBrowserProgram,
} from "../apps/web/src/stamp-client.js";
import { walletPoolAction, type BrowserPosition } from "../apps/web/src/stamp-state.js";
import type { PublicPool } from "../apps/web/src/types.js";
import { createAnchorWalletAdapter, type CompatibleWallet } from "../apps/web/src/wallet.js";

const owner = Keypair.generate().publicKey;
const other = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const poolAddress = Keypair.generate().publicKey;

function pool(status = "open"): PublicPool {
  return {
    address: poolAddress.toBase58(),
    creator: owner.toBase58(),
    poolId: "7",
    fixtureId: "18257865",
    mint: mint.toBase58(),
    tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
    entryFee: "1000000",
    cutoffAt: "200",
    settleAfter: "300",
    refundAfter: "400",
    status,
    maxEntries: 8,
    entryCount: 1,
    finalVector: [2, 1, 5, 4],
    winnerMask: 1,
    winnerCount: 1,
    winnersClaimed: 0,
    winningDistance: 1,
    prizeTotal: "1000000",
    claimedTotal: "0",
    proofTs: "0",
    settlementRoot: Array(32).fill(0),
    settler: PublicKey.default.toBase58(),
    entries: [{ index: 0, owner: owner.toBase58(), forecast: [2, 1, 6, 4] }],
  };
}

function position(paid = false): BrowserPosition {
  return {
    pool: poolAddress,
    owner,
    values: [2, 1, 6, 4],
    entryIndex: 0,
    paid,
    bump: 1,
  };
}

test("wallet action state follows pool, ownership, winner, and payment gates", () => {
  assert.equal(walletPoolAction(pool("open"), null, null), "connect");
  assert.equal(walletPoolAction(pool("open"), other, null), "enter");
  assert.equal(walletPoolAction(pool("open"), owner, position()), "waiting");
  assert.equal(walletPoolAction(pool("locked"), owner, position()), "waiting");
  assert.equal(walletPoolAction(pool("locked"), other, null), "closed");
  assert.equal(walletPoolAction(pool("settled"), owner, position()), "claim");
  assert.equal(walletPoolAction(pool("settled"), owner, position(true)), "paid");
  assert.equal(walletPoolAction(pool("refundable"), owner, position()), "refund");
});

test("browser builders encode create, enter, claim, and refund with canonical accounts", async () => {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const creator = Keypair.generate();
  const program = createBrowserProgram(connection, new Wallet(creator));
  assert(program.programId.equals(STAMP_PROGRAM_ID));

  const poolId = 991n;
  const created = await buildCreatePoolInstruction(program, creator.publicKey, {
    poolId,
    fixtureId: 18_257_865,
    entryFee: 1_000_000n,
    maxEntries: 8,
    cutoffAt: 2_000_000_000,
    settleAfter: 2_000_014_400,
    refundAfter: 2_000_100_800,
    mint,
  });
  const [expectedPool] = derivePoolPda(program.programId, creator.publicKey, poolId);
  const [expectedVault] = deriveVaultPda(program.programId, expectedPool);
  assert(created.pool.equals(expectedPool));
  assert(created.vault.equals(expectedVault));
  assert(created.instruction.programId.equals(STAMP_PROGRAM_ID));

  const current = pool("open");
  const entered = await buildEnterPoolInstruction(program, current, owner, [2, 1, 6, 4]);
  const [expectedPosition] = derivePositionPda(program.programId, poolAddress, owner);
  assert(entered.position.equals(expectedPosition));
  assert(entered.ownerTokens.equals(getAssociatedTokenAddressSync(mint, owner)));
  assert(entered.instruction.programId.equals(STAMP_PROGRAM_ID));

  const claimed = await buildClaimPrizeInstruction(program, pool("settled"), owner);
  const refunded = await buildRefundEntryInstruction(program, pool("refundable"), owner);
  assert(claimed.position.equals(expectedPosition));
  assert(refunded.position.equals(expectedPosition));
  assert(claimed.instruction.programId.equals(STAMP_PROGRAM_ID));
  assert(refunded.instruction.programId.equals(STAMP_PROGRAM_ID));
  assert.notDeepEqual(claimed.instruction.data, refunded.instruction.data);
});

test("Wallet Standard signer round-trips valid legacy transactions for Anchor", async () => {
  const signer = Keypair.generate();
  const account: WalletAccount = {
    address: signer.publicKey.toBase58(),
    publicKey: signer.publicKey.toBytes(),
    chains: ["solana:devnet"],
    features: [SolanaSignTransaction],
  };
  const wallet = {
    version: "1.0.0",
    name: "Test Wallet",
    icon: "data:image/svg+xml;base64,PHN2Zy8+",
    chains: ["solana:devnet"],
    accounts: [account],
    features: {
      [StandardConnect]: {
        version: "1.0.0",
        connect: async () => ({ accounts: [account] }),
      },
      [SolanaSignTransaction]: {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy"],
        signTransaction: async (...inputs: Array<{ transaction: Uint8Array }>) => inputs.map(({ transaction }) => {
          const value = Transaction.from(transaction);
          value.partialSign(signer);
          return {
            signedTransaction: value.serialize({
              requireAllSignatures: false,
              verifySignatures: false,
            }),
          };
        }),
      },
    },
  } as unknown as CompatibleWallet;
  const anchorWallet = createAnchorWalletAdapter(wallet, account);
  const transfer = new Transaction({
    feePayer: signer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(SystemProgram.transfer({
    fromPubkey: signer.publicKey,
    lamports: 1,
    toPubkey: Keypair.generate().publicKey,
  }));
  const signed = await anchorWallet.signTransaction(transfer);
  assert.equal(signed.signatures.length, 1);
  assert(signed.signatures[0]?.signature);
  assert.equal(signed.verifySignatures(), true);
  const batch = await anchorWallet.signAllTransactions([
    transfer,
    new Transaction({
      feePayer: signer.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
    }).add(SystemProgram.transfer({
      fromPubkey: signer.publicKey,
      lamports: 2,
      toPubkey: Keypair.generate().publicKey,
    })),
  ]);
  assert.equal(batch.length, 2);
  assert(batch.every((value) => value.verifySignatures()));
});
