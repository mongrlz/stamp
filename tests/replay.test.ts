import assert from "node:assert/strict";
import test from "node:test";

import { fingerprintDistance, paperStandings } from "../packages/stamp-sdk/src/scoring.js";
import { normalizeReplay } from "../packages/txline/src/replay.js";

const block = (id: number, data: Record<string, unknown>) =>
  `id: ${id}\nevent: scores\ndata: ${JSON.stringify(data)}\n\n`;

test("replay normalization emits only safe milestones and fingerprint changes", () => {
  const fixtureId = 7;
  const text = [
    block(0, { FixtureId: fixtureId, Seq: 0, Action: "connected", StartTime: 1000, Participant1Id: 10, Participant2Id: 20, Participant1IsHome: true, Stats: {} }),
    block(1, { FixtureId: fixtureId, Seq: 1, Action: "kickoff", Clock: { Seconds: 0 }, Stats: {} }),
    block(2, { FixtureId: fixtureId, Seq: 2, Action: "possession", Secret: "hidden", Stats: { 1: 0, 2: 0, 7: 0, 8: 0 } }),
    block(3, { FixtureId: fixtureId, Seq: 3, Action: "goal", Participant: 1, Clock: { Seconds: 90 }, Stats: { 1: 1, 2: 0, 7: 0, 8: 0 } }),
    block(4, { FixtureId: fixtureId, Seq: 4, Action: "corner", Participant: 2, Clock: { Seconds: 180 }, Stats: { 1: 1, 2: 0, 7: 0, 8: 1 } }),
    block(5, { FixtureId: fixtureId, Seq: 5, Action: "game_finalised", Stats: { 1: 1, 2: 0, 7: 0, 8: 1 } }),
  ].join("");
  const replay = normalizeReplay(text, fixtureId);
  assert.equal(replay.frameCount, 4);
  assert.deepEqual(replay.frames.map(({ action }) => action), ["kickoff", "goal", "corner", "game_finalised"]);
  assert.deepEqual(replay.finalFingerprint, [1, 0, 0, 1]);
  assert.equal(replay.finalSequence, 5);
  assert.equal(replay.frames.at(-1)?.clockSeconds, 180);
  assert(!JSON.stringify(replay).includes("hidden"));
});

test("paper scoring matches contract weights, ranks ties, and splits the paper pot", () => {
  assert.equal(fingerprintDistance([2, 1, 6, 4], [2, 1, 5, 5]), 2);
  const standings = paperStandings({
    actual: [2, 1, 5, 5],
    paperStake: 1_000_000n,
    entries: [
      { id: "me", label: "You", fingerprint: [2, 1, 6, 4] },
      { id: "tie", label: "North Stand", fingerprint: [2, 1, 4, 6] },
      { id: "far", label: "Away End", fingerprint: [0, 0, 0, 0] },
    ],
  });
  assert.deepEqual(standings.map(({ id, rank }) => [id, rank]), [["me", 1], ["tie", 1], ["far", 2]]);
  assert.equal(standings[0]!.hypotheticalPayout, "1500000");
  assert.equal(standings[1]!.hypotheticalPayout, "1500000");
  assert.equal(standings[2]!.hypotheticalPayout, "0");
});
