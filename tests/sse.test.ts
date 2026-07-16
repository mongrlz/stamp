import assert from "node:assert/strict";
import test from "node:test";

import { finalizedSequence, normalizeScoreEvent } from "../packages/txline/src/events.js";
import { parseSseText } from "../packages/txline/src/sse.js";

test("parses replay SSE and finds the final TxLINE sequence", () => {
  const text = [
    'id: 10\nevent: scores\ndata: {"FixtureId":7,"Seq":10,"Action":"goal"}',
    'id: 42\nevent: scores\ndata: {"FixtureId":7,"Seq":42,"Action":"game_finalised"}',
  ].join("\n\n");
  const events = parseSseText(text)
    .map(({ data }) => normalizeScoreEvent(data))
    .filter((event) => event !== null);
  assert.equal(finalizedSequence(events), 42);
});
