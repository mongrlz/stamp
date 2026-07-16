import type { ReplayResponse } from "./types.js";

const REPLAY_FIXTURE_ID = 18_179_550;

export async function fetchReplay(signal?: AbortSignal): Promise<ReplayResponse> {
  const response = await fetch(`/api/matches/${REPLAY_FIXTURE_ID}/replay`, { signal });
  if (!response.ok) throw new Error(`Replay service returned HTTP ${response.status}`);
  const replay = await response.json() as ReplayResponse;
  if (
    replay.fixtureId !== REPLAY_FIXTURE_ID
    || !Array.isArray(replay.frames)
    || replay.frames.length === 0
    || !replay.finalized
    || !replay.finalFingerprint
  ) {
    throw new Error("Replay service returned an incomplete match archive");
  }
  return replay;
}
