import { STAMP_STAT_KEYS } from "./constants.js";
import { normalizeScoreEvent } from "./events.js";
import { parseSseText } from "./sse.js";

export type MatchFingerprint = [number, number, number, number];

export type ReplayFrame = {
  sequence: number;
  timestamp: number | null;
  clockSeconds: number | null;
  action: string;
  participant: number | null;
  confirmed: boolean | null;
  fingerprint: MatchFingerprint;
  changed: number[];
  final: boolean;
};

export type MatchReplay = {
  fixtureId: number;
  startTime: number | null;
  participant1Id: number | null;
  participant2Id: number | null;
  participant1IsHome: boolean | null;
  frameCount: number;
  maxSequence: number;
  finalized: boolean;
  finalSequence: number | null;
  finalFingerprint: MatchFingerprint | null;
  frames: ReplayFrame[];
};

const STATE_ACTIONS = new Set([
  "kickoff",
  "halftime_finalised",
  "status",
  "var",
  "var_end",
  "penalty",
  "penalty_outcome",
  "yellow_card",
  "game_finalised",
]);

function safeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function nextFingerprint(
  stats: Record<string, number> | null | undefined,
  previous: MatchFingerprint,
): MatchFingerprint {
  return STAMP_STAT_KEYS.map((key, index) => {
    const value = stats?.[String(key)];
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? value
      : previous[index]!;
  }) as MatchFingerprint;
}

function clockSeconds(raw: Record<string, unknown>): number | null {
  const clock = raw.Clock;
  if (!clock || typeof clock !== "object") return null;
  const value = (clock as Record<string, unknown>).Seconds;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function normalizeReplay(text: string, expectedFixtureId: number): MatchReplay {
  if (!Number.isSafeInteger(expectedFixtureId) || expectedFixtureId <= 0) {
    throw new Error("Replay fixture id must be a positive safe integer");
  }
  let fingerprint: MatchFingerprint = [0, 0, 0, 0];
  let startTime: number | null = null;
  let participant1Id: number | null = null;
  let participant2Id: number | null = null;
  let participant1IsHome: boolean | null = null;
  let currentClockSeconds: number | null = null;
  let maxSequence = -1;
  let finalSequence: number | null = null;
  let finalFingerprint: MatchFingerprint | null = null;
  const frames: ReplayFrame[] = [];

  for (const record of parseSseText(text)) {
    const event = normalizeScoreEvent(record.data);
    if (!event || event.fixtureId !== expectedFixtureId || event.seq === undefined) continue;
    if (!Number.isSafeInteger(event.seq) || event.seq < 0 || event.seq <= maxSequence) continue;
    maxSequence = event.seq;
    const raw = event.raw;
    startTime ??= safeInteger(raw.StartTime);
    participant1Id ??= safeInteger(raw.Participant1Id);
    participant2Id ??= safeInteger(raw.Participant2Id);
    if (participant1IsHome === null && typeof raw.Participant1IsHome === "boolean") {
      participant1IsHome = raw.Participant1IsHome;
    }
    currentClockSeconds = clockSeconds(raw) ?? currentClockSeconds;
    const next = nextFingerprint(event.stats, fingerprint);
    const changed = next.flatMap((value, index) => value !== fingerprint[index] ? [index] : []);
    fingerprint = next;
    const action = event.action ?? "provider_event";
    const final = action === "game_finalised";
    if (final) {
      finalSequence = event.seq;
      finalFingerprint = [...fingerprint];
    }
    if (changed.length === 0 && !STATE_ACTIONS.has(action)) continue;
    frames.push({
      sequence: event.seq,
      timestamp: event.timestamp ?? null,
      clockSeconds: currentClockSeconds,
      action,
      participant: event.participant ?? null,
      confirmed: event.confirmed ?? null,
      fingerprint: [...fingerprint],
      changed,
      final,
    });
  }

  if (maxSequence < 0) throw new Error(`Fixture ${expectedFixtureId} returned no replay events`);
  return {
    fixtureId: expectedFixtureId,
    startTime,
    participant1Id,
    participant2Id,
    participant1IsHome,
    frameCount: frames.length,
    maxSequence,
    finalized: finalSequence !== null,
    finalSequence,
    finalFingerprint,
    frames,
  };
}
