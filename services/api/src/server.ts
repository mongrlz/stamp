import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { PublicKey } from "@solana/web3.js";

import { normalizeScoreEvent } from "../../../packages/txline/src/events.js";
import type { SseRecord } from "../../../packages/txline/src/sse.js";
import { publicPool, settlementReceipt, type RawPool } from "../../shared/src/pool.js";
import { publicFixtures } from "./fixtures.js";

export type ApiDependencies = {
  programId: PublicKey;
  health(): Promise<Record<string, unknown>>;
  fixtures(): Promise<unknown>;
  replay(fixtureId: number): Promise<unknown>;
  pool(address: PublicKey): Promise<RawPool>;
  scoresStream(options: { fixtureId: number; signal: AbortSignal }): AsyncGenerator<SseRecord>;
};

export type ApiServerOptions = {
  corsOrigin?: string;
};

function headers(corsOrigin: string): Record<string, string> {
  return {
    "access-control-allow-origin": corsOrigin,
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
}

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
  corsOrigin: string,
): void {
  response.writeHead(status, {
    ...headers(corsOrigin),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function publicKey(value: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new RouteError(400, "Invalid Solana public key");
  }
}

function fixtureId(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed.toString() !== value) {
    throw new RouteError(400, "Invalid fixture id");
  }
  return parsed;
}

class RouteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function publicLiveEvent(record: SseRecord): Record<string, unknown> {
  const normalized = normalizeScoreEvent(record.data);
  if (!normalized) {
    const data = record.data && typeof record.data === "object"
      ? record.data as Record<string, unknown>
      : {};
    return {
      type: record.event === "heartbeat" ? "heartbeat" : "provider-event",
      timestamp: typeof data.Ts === "number" ? data.Ts : null,
    };
  }
  const { raw: _raw, ...safe } = normalized;
  return { type: "score", ...safe };
}

async function streamScores(
  request: IncomingMessage,
  response: ServerResponse,
  deps: ApiDependencies,
  id: number,
  corsOrigin: string,
): Promise<void> {
  response.writeHead(200, {
    ...headers(corsOrigin),
    "content-type": "text/event-stream; charset=utf-8",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.flushHeaders();
  const controller = new AbortController();
  request.once("aborted", () => controller.abort());
  response.once("close", () => controller.abort());
  response.write(`event: ready\ndata: ${JSON.stringify({ type: "ready", fixtureId: id })}\n\n`);
  const keepalive = setInterval(() => {
    if (!response.writableEnded) response.write(": keepalive\n\n");
  }, 15_000);
  keepalive.unref();
  try {
    for await (const record of deps.scoresStream({ fixtureId: id, signal: controller.signal })) {
      if (controller.signal.aborted) break;
      const event = publicLiveEvent(record);
      const eventName = typeof event.type === "string" ? event.type : "message";
      const lines = [
        record.id ? `id: ${record.id}` : null,
        `event: ${eventName}`,
        `data: ${JSON.stringify(event)}`,
        "",
        "",
      ].filter((line): line is string => line !== null);
      if (!response.write(lines.join("\n"))) await once(response, "drain");
    }
  } finally {
    clearInterval(keepalive);
    if (!response.writableEnded) response.end();
  }
}

export function createApiServer(
  deps: ApiDependencies,
  options: ApiServerOptions = {},
): Server {
  const corsOrigin = options.corsOrigin ?? "*";
  return createServer(async (request, response) => {
    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204, headers(corsOrigin));
        response.end();
        return;
      }
      if (request.method !== "GET") throw new RouteError(405, "Method not allowed");
      const url = new URL(request.url ?? "/", "http://stamp.local");
      if (url.pathname === "/health") {
        const health = await deps.health();
        json(response, health.ok === false ? 503 : 200, health, corsOrigin);
        return;
      }
      if (url.pathname === "/api/fixtures") {
        const fixtures = publicFixtures(await deps.fixtures());
        json(response, 200, { fixtures, count: fixtures.length }, corsOrigin);
        return;
      }
      const liveMatch = url.pathname.match(/^\/api\/matches\/(\d+)\/live$/);
      if (liveMatch) {
        await streamScores(request, response, deps, fixtureId(liveMatch[1]!), corsOrigin);
        return;
      }
      const replayMatch = url.pathname.match(/^\/api\/matches\/(\d+)\/replay$/);
      if (replayMatch) {
        json(response, 200, await deps.replay(fixtureId(replayMatch[1]!)), corsOrigin);
        return;
      }
      const receiptMatch = url.pathname.match(/^\/api\/pools\/([^/]+)\/proof$/);
      if (receiptMatch) {
        const address = publicKey(decodeURIComponent(receiptMatch[1]!));
        json(response, 200, settlementReceipt(address, await deps.pool(address)), corsOrigin);
        return;
      }
      const poolMatch = url.pathname.match(/^\/api\/pools\/([^/]+)$/);
      if (poolMatch) {
        const address = publicKey(decodeURIComponent(poolMatch[1]!));
        json(response, 200, publicPool(address, await deps.pool(address)), corsOrigin);
        return;
      }
      json(response, 404, { error: "Not found" }, corsOrigin);
    } catch (error) {
      if (response.headersSent) {
        if (!response.writableEnded) response.end();
        return;
      }
      const status = error instanceof RouteError ? error.status : 500;
      const message = error instanceof RouteError
        ? error.message
        : "Internal server error";
      json(response, status, { error: message }, corsOrigin);
    }
  });
}
