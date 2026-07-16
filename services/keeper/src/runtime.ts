import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";

import { TxLineClient } from "../../../packages/txline/src/client.js";
import { connectionFor, createStampProgram } from "../../shared/src/anchor.js";
import { loadKeeperConfig, type KeeperConfig } from "./config.js";
import { readKeypair } from "./keypair.js";

export type KeeperRuntime = {
  config: KeeperConfig;
  keeper: Keypair;
  program: Program;
  txline: TxLineClient;
  oracleProgram: PublicKey;
};

export function createKeeperRuntime(config = loadKeeperConfig()): KeeperRuntime {
  const keeper = readKeypair(config.keeperKeypairPath);
  const expectedProgramId = new PublicKey(config.stampProgramId);
  const connection = connectionFor(config.rpcUrl);
  const program = createStampProgram({
    connection,
    expectedProgramId,
    payer: keeper,
  });
  return {
    config,
    keeper,
    program,
    txline: new TxLineClient(config.txline),
    oracleProgram: new PublicKey(config.oracleProgramId),
  };
}
