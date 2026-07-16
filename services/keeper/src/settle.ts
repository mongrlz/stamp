import { PublicKey } from "@solana/web3.js";

import { createKeeperRuntime } from "./runtime.js";
import { settlePoolAddress } from "./settlement.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const poolArgument = argument("--pool");
  if (!poolArgument) {
    throw new Error("Usage: npm run keeper:settle -- --pool <POOL_PUBKEY> [--seq <N>]");
  }
  const sequenceArgument = argument("--seq");
  const sequence = sequenceArgument === undefined
    ? undefined
    : Number.parseInt(sequenceArgument, 10);
  const runtime = createKeeperRuntime();
  const result = await settlePoolAddress({
    ...runtime,
    poolAddress: new PublicKey(poolArgument),
    sequence,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
