import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";

import { bnNumber, poolStatus, type RawPool } from "../../shared/src/pool.js";
import { createKeeperRuntime } from "./runtime.js";
import { runKeeperPass, type KeeperCandidate } from "./daemon-core.js";
import { fetchPool, settlePoolAddress } from "./settlement.js";

async function candidatesFor(program: Program, configured: string[]): Promise<KeeperCandidate[]> {
  const records: Array<{ publicKey: PublicKey; account: RawPool }> = configured.length > 0
    ? await Promise.all(configured.map(async (value) => {
        const publicKey = new PublicKey(value);
        return { publicKey, account: await fetchPool(program, publicKey) };
      }))
    : await (program.account as unknown as {
        pool: { all(): Promise<Array<{ publicKey: PublicKey; account: RawPool }>> };
      }).pool.all();
  return records.map(({ publicKey, account }) => ({
    address: publicKey,
    status: poolStatus(account),
    entryCount: bnNumber(account.entryCount, "entryCount"),
    cutoffAt: bnNumber(account.cutoffAt, "cutoffAt"),
    settleAfter: bnNumber(account.settleAfter, "settleAfter"),
    refundAfter: bnNumber(account.refundAfter, "refundAfter"),
  }));
}

async function markRefundable(
  program: Program,
  keeper: Keypair,
  pool: PublicKey,
): Promise<string> {
  return (program.methods as unknown as {
    markRefundable(): {
      accounts(value: { actor: PublicKey; pool: PublicKey }): {
        signers(value: Keypair[]): { rpc(): Promise<string> };
      };
    };
  }).markRefundable().accounts({ actor: keeper.publicKey, pool }).signers([keeper]).rpc();
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  const runtime = createKeeperRuntime();
  let stopped = false;
  const stop = () => { stopped = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  do {
    const startedAt = new Date().toISOString();
    try {
      const candidates = await candidatesFor(runtime.program, runtime.config.poolAddresses);
      const results = await runKeeperPass({
        candidates,
        settle: (poolAddress) => settlePoolAddress({ ...runtime, poolAddress }),
        markRefundable: (poolAddress) => markRefundable(
          runtime.program,
          runtime.keeper,
          poolAddress,
        ),
      });
      process.stdout.write(`${JSON.stringify({
        level: "info",
        event: "keeper_pass",
        startedAt,
        poolCount: candidates.length,
        results,
      })}\n`);
    } catch (error) {
      process.stderr.write(`${JSON.stringify({
        level: "error",
        event: "keeper_pass_failed",
        startedAt,
        error: error instanceof Error ? error.message : String(error),
      })}\n`);
    }
    if (once || stopped) break;
    await new Promise((resolve) => setTimeout(resolve, runtime.config.pollIntervalMs));
  } while (!stopped);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
