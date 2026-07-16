import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";

import { createApiServer, type ApiDependencies } from "../services/api/src/server.js";

const programId = new PublicKey("7Xh5gJZN2SoYmDLsVQKtqFoB8pxrvykn9S8hjFWguE5o");
const poolAddress = Keypair.generate().publicKey;
const ownerA = Keypair.generate().publicKey;
const ownerB = Keypair.generate().publicKey;

function fakePool(status: "locked" | "settled" = "locked") {
  return {
    creator: ownerA,
    poolId: new BN(7),
    fixtureId: new BN(18257865),
    mint: Keypair.generate().publicKey,
    tokenProgram: Keypair.generate().publicKey,
    entryFee: new BN(1_000_000),
    cutoffAt: new BN(100),
    settleAfter: new BN(200),
    refundAfter: new BN(300),
    status: { [status]: {} },
    maxEntries: 2,
    entryCount: 2,
    finalVector: status === "settled" ? [2, 1, 5, 4] : [0, 0, 0, 0],
    winnerMask: status === "settled" ? 1 : 0,
    winnerCount: status === "settled" ? 1 : 0,
    winnersClaimed: 0,
    winningDistance: status === "settled" ? 1 : 0,
    prizeTotal: new BN(status === "settled" ? 2_000_000 : 0),
    claimedTotal: new BN(0),
    proofTs: new BN(status === "settled" ? 500 : 0),
    settlementRoot: status === "settled" ? Array(32).fill(9) : Array(32).fill(0),
    settler: status === "settled" ? ownerB : PublicKey.default,
    entries: [
      { owner: ownerA, values: [2, 1, 6, 4], occupied: true },
      { owner: ownerB, values: [1, 1, 5, 5], occupied: true },
    ],
  };
}

function dependencies(status: "locked" | "settled" = "locked"): ApiDependencies {
  return {
    programId,
    health: async () => ({ ok: true, slot: 42, program: programId.toBase58() }),
    fixtures: async () => ([
      {
        FixtureId: 2,
        StartTime: 200,
        Competition: "World Cup",
        Participant1: "France",
        Participant2: "England",
        SecretProviderField: "must-not-leak",
      },
      {
        FixtureId: 1,
        StartTime: 100,
        Competition: "World Cup",
        Participant1: "Spain",
        Participant2: "Argentina",
      },
    ]),
    replay: async (fixtureId) => ({
      fixtureId,
      finalized: true,
      finalSequence: 42,
      finalFingerprint: [3, 2, 4, 2],
      frames: [{ sequence: 42, action: "game_finalised", fingerprint: [3, 2, 4, 2] }],
    }),
    pool: async () => fakePool(status),
    scoresStream: async function* () {
      yield {
        id: "9",
        event: "scores",
        data: {
          FixtureId: 18257865,
          Seq: 9,
          Action: "goal",
          Participant: 1,
          SecretProviderField: "must-not-leak",
        },
      };
      yield { event: "heartbeat", data: { Ts: 123, SecretProviderField: "must-not-leak" } };
    },
  };
}

async function withServer<T>(deps: ApiDependencies, run: (base: string) => Promise<T>): Promise<T> {
  const server = createApiServer(deps);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("API exposes health and sanitized, time-sorted fixtures", async () => {
  await withServer(dependencies(), async (base) => {
    const health = await (await fetch(`${base}/health`)).json() as any;
    assert.equal(health.ok, true);
    const response = await fetch(`${base}/api/fixtures`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.deepEqual(body.fixtures.map((item: any) => item.fixtureId), [1, 2]);
    assert(!JSON.stringify(body).includes("must-not-leak"));
  });
});

test("API exposes a public pool and deterministic settlement receipt", async () => {
  await withServer(dependencies("settled"), async (base) => {
    const pool = await (await fetch(`${base}/api/pools/${poolAddress}`)).json() as any;
    assert.equal(pool.status, "settled");
    assert.equal(pool.entries.length, 2);
    const receipt = await (await fetch(`${base}/api/pools/${poolAddress}/proof`)).json() as any;
    assert.equal(receipt.settled, true);
    assert.deepEqual(receipt.finalVector, [2, 1, 5, 4]);
    assert.equal(receipt.winners.length, 1);
    assert.equal(receipt.winners[0].owner, ownerA.toBase58());
    assert.equal(receipt.proof.eventSubtreeRootHex, "09".repeat(32));
  });
});

test("API exposes a normalized historical replay", async () => {
  await withServer(dependencies(), async (base) => {
    const response = await fetch(`${base}/api/matches/18179550/replay`);
    assert.equal(response.status, 200);
    const replay = await response.json() as any;
    assert.equal(replay.finalized, true);
    assert.equal(replay.finalSequence, 42);
    assert.deepEqual(replay.finalFingerprint, [3, 2, 4, 2]);
  });
});

test("API relays normalized live SSE without provider-only raw fields", async () => {
  await withServer(dependencies(), async (base) => {
    const response = await fetch(`${base}/api/matches/18257865/live`);
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    const body = await response.text();
    assert(body.includes("event: ready"));
    assert(body.includes("event: score"));
    assert(body.includes('"action":"goal"'));
    assert(body.includes("event: heartbeat"));
    assert(!body.includes("must-not-leak"));
  });
});

test("API rejects invalid public keys and non-GET writes", async () => {
  await withServer(dependencies(), async (base) => {
    assert.equal((await fetch(`${base}/api/pools/not-a-key`)).status, 400);
    assert.equal((await fetch(`${base}/api/fixtures`, { method: "POST" })).status, 405);
  });
});
