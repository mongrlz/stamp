import { STAMP_STAT_KEYS } from "./constants.js";
import { finalizedSequence, normalizeScoreEvent, type NormalizedScoreEvent } from "./events.js";
import { parseStampSettlementProof, type StampSettlementProof } from "./proof.js";
import { parseSseStream, parseSseText, type SseRecord } from "./sse.js";

export type TxLineClientConfig = {
  baseUrl: string;
  apiToken: string;
  jwt?: string;
};

export class TxLineClient {
  readonly baseUrl: string;
  readonly apiToken: string;
  #jwt?: string;

  constructor(config: TxLineClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiToken = config.apiToken;
    this.#jwt = config.jwt;
  }

  async refreshJwt(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/auth/guest/start`, { method: "POST" });
    if (!response.ok) throw new Error(`TxLINE guest/start returned HTTP ${response.status}`);
    const body = (await response.json()) as { token?: unknown };
    if (typeof body.token !== "string") throw new Error("TxLINE guest/start returned no JWT");
    this.#jwt = body.token;
    return body.token;
  }

  async request(path: string): Promise<Response> {
    if (!this.#jwt) await this.refreshJwt();
    let response = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    if (response.status === 401) {
      await this.refreshJwt();
      response = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    }
    if (!response.ok) {
      throw new Error(`TxLINE GET ${path} returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    return response;
  }

  async fixtures(): Promise<unknown> {
    return (await this.request("/api/fixtures/snapshot")).json();
  }

  async scoresSnapshot(fixtureId: number): Promise<unknown> {
    return (await this.request(`/api/scores/snapshot/${fixtureId}`)).json();
  }

  async scoresUpdatesText(fixtureId: number): Promise<string> {
    return (await this.request(`/api/scores/updates/${fixtureId}`)).text();
  }

  async finalizedSequence(fixtureId: number): Promise<number> {
    const records = parseSseText(await this.scoresUpdatesText(fixtureId));
    const events = records
      .map(({ data }) => normalizeScoreEvent(data))
      .filter((event): event is NormalizedScoreEvent => event !== null);
    const sequence = finalizedSequence(events);
    if (sequence === null) throw new Error(`Fixture ${fixtureId} has no game_finalised event`);
    return sequence;
  }

  async stampProof(fixtureId: number, sequence: number): Promise<StampSettlementProof> {
    const query = new URLSearchParams({
      fixtureId: fixtureId.toString(),
      seq: sequence.toString(),
      statKeys: STAMP_STAT_KEYS.join(","),
    });
    const raw = await (await this.request(`/api/scores/stat-validation-v3?${query}`)).json();
    return parseStampSettlementProof(raw, fixtureId);
  }

  async *scoresStream(options: {
    fixtureId?: number;
    signal?: AbortSignal;
  } = {}): AsyncGenerator<SseRecord> {
    const url = new URL(`${this.baseUrl}/api/scores/stream`);
    if (options.fixtureId !== undefined) {
      url.searchParams.set("fixtureId", options.fixtureId.toString());
    }
    let lastEventId: string | undefined;
    let backoff = 1_000;
    while (!options.signal?.aborted) {
      try {
        if (!this.#jwt) await this.refreshJwt();
        const response = await fetch(url, {
          headers: this.headers(lastEventId ? { "Last-Event-ID": lastEventId } : undefined),
          signal: options.signal,
        });
        if (response.status === 401) {
          await this.refreshJwt();
          continue;
        }
        if (!response.ok || !response.body) {
          throw new Error(`TxLINE scores stream returned HTTP ${response.status}`);
        }
        backoff = 1_000;
        for await (const record of parseSseStream(response.body)) {
          if (record.id) lastEventId = record.id;
          yield record;
        }
      } catch (error) {
        if (options.signal?.aborted) return;
        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff = Math.min(backoff * 2, 15_000);
      }
    }
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    if (!this.#jwt) throw new Error("TxLINE JWT has not been initialized");
    return {
      Authorization: `Bearer ${this.#jwt}`,
      "X-Api-Token": this.apiToken,
      ...extra,
    };
  }
}
