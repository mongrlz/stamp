export type NormalizedScoreEvent = {
  fixtureId: number;
  seq?: number;
  timestamp?: number;
  action?: string;
  participant?: number | null;
  confirmed?: boolean;
  score?: unknown;
  stats?: Record<string, number> | null;
  raw: Record<string, unknown>;
};

export function normalizeScoreEvent(input: unknown): NormalizedScoreEvent | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const fixtureId = raw.FixtureId;
  if (typeof fixtureId !== "number") return null;
  const data = raw.Data && typeof raw.Data === "object"
    ? (raw.Data as Record<string, unknown>)
    : undefined;
  return {
    fixtureId,
    seq: typeof raw.Seq === "number" ? raw.Seq : undefined,
    timestamp: typeof raw.Ts === "number" ? raw.Ts : undefined,
    action: typeof raw.Action === "string" ? raw.Action : undefined,
    participant:
      typeof raw.Participant === "number"
        ? raw.Participant
        : typeof data?.Participant === "number"
          ? data.Participant
          : null,
    confirmed: typeof raw.Confirmed === "boolean" ? raw.Confirmed : undefined,
    score: raw.Score,
    stats:
      raw.Stats && typeof raw.Stats === "object"
        ? (raw.Stats as Record<string, number>)
        : null,
    raw,
  };
}

export function finalizedSequence(events: Iterable<NormalizedScoreEvent>): number | null {
  let sequence: number | null = null;
  for (const event of events) {
    if (event.action === "game_finalised" && event.seq !== undefined) {
      sequence = Math.max(sequence ?? event.seq, event.seq);
    }
  }
  return sequence;
}
