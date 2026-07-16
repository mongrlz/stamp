import fs from "node:fs";
import { Keypair } from "@solana/web3.js";

export function readKeypair(filePath: string): Keypair {
  const bytes = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  if (!Array.isArray(bytes) || !bytes.every((value) => Number.isInteger(value))) {
    throw new Error(`Invalid Solana keypair JSON at ${filePath}`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
}
