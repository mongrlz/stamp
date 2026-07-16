import { z } from "zod";

import { loadTxLineCredentials, type TxLineCredentials } from "../../shared/src/config.js";

const schema = z.object({
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  API_CORS_ORIGIN: z.string().default("*"),
  SOLANA_RPC_URL: z.string().url().default("https://api.devnet.solana.com"),
  STAMP_PROGRAM_ID: z.string().min(32),
});

export type ApiConfig = {
  host: string;
  port: number;
  corsOrigin: string;
  rpcUrl: string;
  stampProgramId: string;
  txline: TxLineCredentials;
};

export function loadApiConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const value = schema.parse(environment);
  return {
    host: value.API_HOST,
    port: value.API_PORT,
    corsOrigin: value.API_CORS_ORIGIN,
    rpcUrl: value.SOLANA_RPC_URL,
    stampProgramId: value.STAMP_PROGRAM_ID,
    txline: loadTxLineCredentials(environment),
  };
}
