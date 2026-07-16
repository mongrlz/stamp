import fs from "node:fs";
import path from "node:path";

export type TxLineCredentials = {
  baseUrl: string;
  jwt?: string;
  apiToken: string;
};

export function loadTxLineCredentials(environment: NodeJS.ProcessEnv): TxLineCredentials {
  let fileCredentials: {
    base?: unknown;
    baseUrl?: unknown;
    jwt?: unknown;
    apiToken?: unknown;
  } = {};
  if (environment.TXLINE_TOKEN_FILE) {
    const tokenPath = path.resolve(environment.TXLINE_TOKEN_FILE);
    fileCredentials = JSON.parse(fs.readFileSync(tokenPath, "utf8")) as typeof fileCredentials;
  }

  const baseUrl = environment.TXLINE_BASE_URL
    ?? (typeof fileCredentials.baseUrl === "string" ? fileCredentials.baseUrl : undefined)
    ?? (typeof fileCredentials.base === "string" ? fileCredentials.base : undefined);
  const jwt = environment.TXLINE_JWT
    ?? (typeof fileCredentials.jwt === "string" ? fileCredentials.jwt : undefined);
  const rawToken = environment.TXLINE_API_TOKEN ?? fileCredentials.apiToken;
  const apiToken = typeof rawToken === "string"
    ? rawToken
    : rawToken === undefined
      ? undefined
      : JSON.stringify(rawToken);

  if (!baseUrl || !URL.canParse(baseUrl) || !apiToken) {
    throw new Error(
      "Provide TXLINE_TOKEN_FILE or valid TXLINE_BASE_URL and TXLINE_API_TOKEN values",
    );
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), jwt, apiToken };
}
