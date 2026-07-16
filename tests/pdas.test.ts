import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";

import { derivePoolPda, derivePositionPda, deriveVaultPda } from "../packages/stamp-sdk/src/pdas.js";

test("wallet, pool id, and program deterministically own every STAMP position", () => {
  const program = new PublicKey("7Xh5gJZN2SoYmDLsVQKtqFoB8pxrvykn9S8hjFWguE5o");
  const creator = new PublicKey("11111111111111111111111111111111");
  const owner = new PublicKey("SysvarRent111111111111111111111111111111111");
  const [pool] = derivePoolPda(program, creator, 77n);
  const [samePool] = derivePoolPda(program, creator, 77n);
  const [vault] = deriveVaultPda(program, pool);
  const [position] = derivePositionPda(program, pool, owner);
  assert(pool.equals(samePool));
  assert(!vault.equals(position));
});
