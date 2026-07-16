import path from "node:path";
import { z } from "zod";

import { loadTxLineCredentials, type TxLineCredentials } from "../../shared/src/config.js";

const environmentSchema = z.object({
  SOLANA_RPC_URL: z.string().url().default("https://api.devnet.solana.com"),
  STAMP_PROGRAM_ID: z.string().min(32),
  TXLINE_ORACLE_PROGRAM_ID: z.string().min(32),
  KEEPER_KEYPAIR_PATH: z.string().min(1),
  TXLINE_TOKEN_FILE: z.string().optional(),
  TXLINE_BASE_URL: z.string().url().optional(),
  TXLINE_JWT: z.string().optional(),
  TXLINE_API_TOKEN: z.string().optional(),
  KEEPER_POOL_ADDRESSES: z.string().optional(),
  KEEPER_POLL_INTERVAL_MS: z.coerce.number().int().min(2_000).max(300_000).default(15_000),
});

export type KeeperConfig = {
  rpcUrl: string;
  stampProgramId: string;
  oracleProgramId: string;
  keeperKeypairPath: string;
  poolAddresses: string[];
  pollIntervalMs: number;
  txline: TxLineCredentials;
};

export function loadKeeperConfig(environment: NodeJS.ProcessEnv = process.env): KeeperConfig {
  const env = environmentSchema.parse(environment);
  return {
    rpcUrl: env.SOLANA_RPC_URL,
    stampProgramId: env.STAMP_PROGRAM_ID,
    oracleProgramId: env.TXLINE_ORACLE_PROGRAM_ID,
    keeperKeypairPath: path.resolve(env.KEEPER_KEYPAIR_PATH),
    poolAddresses: (env.KEEPER_POOL_ADDRESSES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    pollIntervalMs: env.KEEPER_POLL_INTERVAL_MS,
    txline: loadTxLineCredentials(environment),
  };
}
