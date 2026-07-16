import type { MatchFingerprint, ReplayFrame } from "../../../packages/txline/src/replay.js";

export type ReplayFixture = {
  fixtureId: number;
  competition: string | null;
  startTime: number | null;
  participant1: string | null;
  participant1Id: number | null;
  participant2: string | null;
  participant2Id: number | null;
  participant1IsHome: boolean | null;
  gameState: number | null;
};

export type ReplayResponse = {
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
  fixture: ReplayFixture | null;
};
