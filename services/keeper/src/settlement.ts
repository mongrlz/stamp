import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";

import { TxLineClient } from "../../../packages/txline/src/client.js";
import { deriveDailyScoresRoot } from "../../../packages/txline/src/proof.js";
import { bnNumber, poolStatus, type RawPool } from "../../shared/src/pool.js";

export type SettlementResult = {
  signature: string;
  pool: string;
  fixtureId: number;
  sequence: number;
  finalVector: number[];
  oracleRoots: string;
};

export async function fetchPool(program: Program, address: PublicKey): Promise<RawPool> {
  return (program.account as unknown as {
    pool: { fetch(value: PublicKey): Promise<RawPool> };
  }).pool.fetch(address);
}

export async function settlePoolAddress(options: {
  program: Program;
  keeper: Keypair;
  txline: TxLineClient;
  oracleProgram: PublicKey;
  poolAddress: PublicKey;
  sequence?: number;
}): Promise<SettlementResult> {
  const pool = await fetchPool(options.program, options.poolAddress);
  const status = poolStatus(pool);
  if (status !== "open" && status !== "locked") {
    throw new Error(`Pool is ${status}; settlement only accepts open or locked pools`);
  }
  const fixtureId = bnNumber(pool.fixtureId, "fixtureId");
  const sequence = options.sequence ?? await options.txline.finalizedSequence(fixtureId);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error("Settlement sequence must be a nonnegative safe integer");
  }
  const proof = await options.txline.stampProof(fixtureId, sequence);
  const [oracleRoots] = deriveDailyScoresRoot(options.oracleProgram, proof.ts);
  const signature = await (options.program.methods as unknown as {
    settlePool(value: typeof proof): {
      accounts(value: Record<string, PublicKey>): {
        signers(value: Keypair[]): { rpc(): Promise<string> };
      };
    };
  }).settlePool(proof).accounts({
    cranker: options.keeper.publicKey,
    pool: options.poolAddress,
    oracleProgram: options.oracleProgram,
    oracleRoots,
  }).signers([options.keeper]).rpc();

  return {
    signature,
    pool: options.poolAddress.toBase58(),
    fixtureId,
    sequence,
    finalVector: proof.leafValues,
    oracleRoots: oracleRoots.toBase58(),
  };
}
