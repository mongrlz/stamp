import type { PublicPool, ReplayResponse } from "./types.js";

const REPLAY_FIXTURE_ID = 18_179_550;
export const LIVE_POOL_ADDRESS = "3TGEb7Bwc1AZ1qxhFpQQZfxop9PZyiHPtyTKNybEZGWH";

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

export async function fetchLivePool(signal?: AbortSignal): Promise<PublicPool> {
  const response = await fetch(`/api/pools/${LIVE_POOL_ADDRESS}`, { signal });
  if (!response.ok) throw new Error(`Pool service returned HTTP ${response.status}`);
  const pool = await response.json() as PublicPool;
  if (
    pool.address !== LIVE_POOL_ADDRESS
    || pool.fixtureId !== "18257865"
    || !Array.isArray(pool.entries)
    || pool.entries.length !== pool.entryCount
  ) {
    throw new Error("Pool service returned an incomplete devnet pool");
  }
  return pool;
}
