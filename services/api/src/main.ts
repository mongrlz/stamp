import { PublicKey } from "@solana/web3.js";

import { TxLineClient } from "../../../packages/txline/src/client.js";
import { normalizeReplay } from "../../../packages/txline/src/replay.js";
import { connectionFor, createStampProgram } from "../../shared/src/anchor.js";
import type { RawPool } from "../../shared/src/pool.js";
import { loadApiConfig } from "./config.js";
import { createApiServer, type ApiDependencies } from "./server.js";
import { publicFixtures } from "./fixtures.js";

async function main(): Promise<void> {
  const config = loadApiConfig();
  const programId = new PublicKey(config.stampProgramId);
  const connection = connectionFor(config.rpcUrl);
  const program = createStampProgram({ connection, expectedProgramId: programId });
  const txline = new TxLineClient(config.txline);
  const replayCache = new Map<number, { expiresAt: number; value: unknown }>();
  const dependencies: ApiDependencies = {
    programId,
    health: async () => {
      const [slot, account] = await Promise.all([
        connection.getSlot("confirmed"),
        connection.getAccountInfo(programId, "confirmed"),
      ]);
      return {
        ok: Boolean(account?.executable),
        service: "stamp-api",
        rpcHost: new URL(config.rpcUrl).host,
        slot,
        program: programId.toBase58(),
        programExecutable: Boolean(account?.executable),
        txlineConfigured: true,
      };
    },
    fixtures: () => txline.fixtures(),
    replay: async (fixtureId) => {
      const cached = replayCache.get(fixtureId);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
      const replay = normalizeReplay(await txline.scoresUpdatesText(fixtureId), fixtureId);
      const epochDay = replay.startTime === null
        ? undefined
        : Math.floor(replay.startTime / 86_400_000);
      const fixtures = publicFixtures(await txline.fixtures({ startEpochDay: epochDay }));
      const value = {
        ...replay,
        fixture: fixtures.find((fixture) => fixture.fixtureId === fixtureId) ?? null,
      };
      replayCache.set(fixtureId, { expiresAt: Date.now() + 10 * 60_000, value });
      return value;
    },
    pool: (address) => (program.account as unknown as {
      pool: { fetch(value: PublicKey): Promise<RawPool> };
    }).pool.fetch(address),
    scoresStream: (options) => txline.scoresStream(options),
  };
  const server = createApiServer(dependencies, { corsOrigin: config.corsOrigin });
  server.listen(config.port, config.host, () => {
    process.stdout.write(`${JSON.stringify({
      level: "info",
      event: "api_listening",
      host: config.host,
      port: config.port,
      program: programId.toBase58(),
    })}\n`);
  });

  const close = () => server.close(() => { process.exitCode = 0; });
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
