import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";

import {
  MILLISECONDS_PER_DAY,
  STAMP_STAT_KEYS,
  TXLINE_DAILY_ROOT_SEED,
  TXLINE_FINAL_PERIOD,
} from "./constants.js";
import { txLineV3ResponseSchema, type TxLineV3Response } from "./schemas.js";

export type AnchorProofNode = {
  hash: number[];
  isRightSibling: boolean;
};

export type StampSettlementProof = {
  ts: BN;
  fixtureSummary: {
    fixtureId: BN;
    updateStats: {
      updateCount: number;
      minTimestamp: BN;
      maxTimestamp: BN;
    };
    eventsSubTreeRoot: number[];
  };
  fixtureProof: AnchorProofNode[];
  mainTreeProof: AnchorProofNode[];
  eventStatRoot: number[];
  leafValues: number[];
  multiproofHashes: AnchorProofNode[];
  leafIndices: number[];
};

function proofNode(node: TxLineV3Response["mainTreeProof"][number]): AnchorProofNode {
  return { hash: [...node.hash], isRightSibling: node.isRightSibling };
}

export function parseStampSettlementProof(
  input: unknown,
  expectedFixtureId: number,
): StampSettlementProof {
  const response = txLineV3ResponseSchema.parse(input);
  if (response.summary.fixtureId !== expectedFixtureId) {
    throw new Error(
      `TxLINE fixture mismatch: expected ${expectedFixtureId}, received ${response.summary.fixtureId}`,
    );
  }
  if (response.statsToProve.length !== STAMP_STAT_KEYS.length) {
    throw new Error(`STAMP requires exactly ${STAMP_STAT_KEYS.length} proven stats`);
  }
  if (response.multiproof.indices.length !== STAMP_STAT_KEYS.length) {
    throw new Error("TxLINE multiproof index count does not match STAMP's four leaves");
  }

  response.statsToProve.forEach(({ stat, statProof }, index) => {
    if (stat.key !== STAMP_STAT_KEYS[index]) {
      throw new Error(
        `Unexpected stat key at index ${index}: expected ${STAMP_STAT_KEYS[index]}, received ${stat.key}`,
      );
    }
    if (stat.period !== TXLINE_FINAL_PERIOD) {
      throw new Error(
        `Unexpected TxLINE period for stat ${stat.key}: expected ${TXLINE_FINAL_PERIOD}, received ${stat.period}`,
      );
    }
    if (statProof.length !== 0) {
      throw new Error("TxLINE v3 leaves must use the shared multiproof, not per-leaf proofs");
    }
  });

  return {
    ts: new BN(response.ts.toString()),
    fixtureSummary: {
      fixtureId: new BN(response.summary.fixtureId),
      updateStats: {
        updateCount: response.summary.updateStats.updateCount,
        minTimestamp: new BN(response.summary.updateStats.minTimestamp.toString()),
        maxTimestamp: new BN(response.summary.updateStats.maxTimestamp.toString()),
      },
      eventsSubTreeRoot: [...response.summary.eventStatsSubTreeRoot],
    },
    fixtureProof: response.subTreeProof.map(proofNode),
    mainTreeProof: response.mainTreeProof.map(proofNode),
    eventStatRoot: [...response.eventStatRoot],
    leafValues: response.statsToProve.map(({ stat }) => stat.value),
    multiproofHashes: response.multiproof.hashes.map(proofNode),
    leafIndices: [...response.multiproof.indices],
  };
}

export function deriveDailyScoresRoot(
  oracleProgram: PublicKey,
  proofTimestampMs: number | BN,
): [PublicKey, number] {
  const timestamp = BN.isBN(proofTimestampMs)
    ? proofTimestampMs.toNumber()
    : proofTimestampMs;
  const epochDay = Math.floor(timestamp / MILLISECONDS_PER_DAY);
  if (epochDay < 0 || epochDay > 0xffff) {
    throw new Error(`Proof epoch day ${epochDay} does not fit TxLINE's u16 PDA seed`);
  }
  const day = Buffer.alloc(2);
  day.writeUInt16LE(epochDay);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(TXLINE_DAILY_ROOT_SEED), day],
    oracleProgram,
  );
}
