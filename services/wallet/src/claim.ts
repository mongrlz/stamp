import path from "node:path";
import { PublicKey } from "@solana/web3.js";

import { connectionFor, createStampProgram } from "../../shared/src/anchor.js";
import { readKeypair } from "../../shared/src/keypair.js";
import { claimPrizeForOwner, inspectClaim } from "./claim-prize.js";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name} argument`);
  return value;
}

async function main(): Promise<void> {
  const poolAddress = new PublicKey(argument("--pool"));
  const owner = readKeypair(path.resolve(argument("--keypair")));
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const programId = new PublicKey(
    process.env.STAMP_PROGRAM_ID ?? "7Xh5gJZN2SoYmDLsVQKtqFoB8pxrvykn9S8hjFWguE5o",
  );
  const program = createStampProgram({
    connection: connectionFor(rpcUrl),
    expectedProgramId: programId,
    payer: owner,
  });
  if (process.argv.includes("--inspect")) {
    const inspected = await inspectClaim({
      program,
      owner: owner.publicKey,
      poolAddress,
    });
    process.stdout.write(`${JSON.stringify({
      pool: poolAddress.toBase58(),
      owner: owner.publicKey.toBase58(),
      position: inspected.positionAddress.toBase58(),
      eligibility: inspected.eligibility,
    }, null, 2)}\n`);
    return;
  }
  const result = await claimPrizeForOwner({ program, owner, poolAddress });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
