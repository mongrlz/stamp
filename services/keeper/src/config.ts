import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const environmentSchema = z.object({
  SOLANA_RPC_URL: z.string().url().default("https://api.devnet.solana.com"),
  STAMP_PROGRAM_ID: z.string().min(32),
  TXLINE_ORACLE_PROGRAM_ID: z.string().min(32),
  KEEPER_KEYPAIR_PATH: z.string().min(1),
  TXLINE_TOKEN_FILE: z.string().optional(),
  TXLINE_BASE_URL: z.string().url().optional(),
  TXLINE_JWT: z.string().optional(),
  TXLINE_API_TOKEN: z.string().optional(),
});

export type KeeperConfig = {
  rpcUrl: string;
  stampProgramId: string;
  oracleProgramId: string;
  keeperKeypairPath: string;
  txline: {
    baseUrl: string;
    jwt?: string;
    apiToken: string;
  };
};

export function loadKeeperConfig(environment: NodeJS.ProcessEnv = process.env): KeeperConfig {
  const env = environmentSchema.parse(environment);
  let credentials: { base?: unknown; baseUrl?: unknown; jwt?: unknown; apiToken?: unknown } = {};
  if (env.TXLINE_TOKEN_FILE) {
    const tokenPath = path.resolve(env.TXLINE_TOKEN_FILE);
    credentials = JSON.parse(fs.readFileSync(tokenPath, "utf8")) as typeof credentials;
  }
  const baseUrl = env.TXLINE_BASE_URL
    ?? (typeof credentials.baseUrl === "string" ? credentials.baseUrl : undefined)
    ?? (typeof credentials.base === "string" ? credentials.base : undefined);
  const jwt = env.TXLINE_JWT
    ?? (typeof credentials.jwt === "string" ? credentials.jwt : undefined);
  const rawToken = env.TXLINE_API_TOKEN ?? credentials.apiToken;
  const apiToken = typeof rawToken === "string"
    ? rawToken
    : rawToken === undefined
      ? undefined
      : JSON.stringify(rawToken);
  if (!baseUrl || !apiToken) {
    throw new Error(
      "Provide TXLINE_TOKEN_FILE or the TXLINE_BASE_URL and TXLINE_API_TOKEN variables",
    );
  }
  return {
    rpcUrl: env.SOLANA_RPC_URL,
    stampProgramId: env.STAMP_PROGRAM_ID,
    oracleProgramId: env.TXLINE_ORACLE_PROGRAM_ID,
    keeperKeypairPath: path.resolve(env.KEEPER_KEYPAIR_PATH),
    txline: { baseUrl, jwt, apiToken },
  };
}
