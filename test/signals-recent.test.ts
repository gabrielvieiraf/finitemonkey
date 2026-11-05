import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeIndex, thresholdsOf } from "../src/signals/loop-index.js";
import { DEFAULT_THRESHOLD, type SignalEntry } from "../src/signals/store.js";

describe("signals: only the recent run of an error counts", () => {
  const errorAt = (turn: number): SignalEntry => ({
    at: `2026-10-27T10:${String(turn).padStart(2, "0")}:00.000Z`,
    session: "s1",
    turn,
    kind: "error",
    sig: "50c3",
    sample: "boom",
    tool: "Bash",
  });
  const promptAt = (turn: number): SignalEntry => ({
    at: `2026-10-27T10:${String(turn).padStart(2, "0")}:30.000Z`,
    session: "s1",
    turn,
    kind: "prompt",
    fp: [`request ${String(turn)}`],
    progress: "",
  });
  const thresholds = thresholdsOf({ threshold: DEFAULT_THRESHOLD, notLoop: 0 });

  it("does not fire for the same failure spread over unrelated requests", () => {
    const entries = [1, 3, 5, 7, 9, 11, 13].flatMap((turn) => [promptAt(turn), promptAt(turn + 1), errorAt(turn)]);
    const index = computeIndex([...entries, promptAt(15)], thresholds);
    assert.equal(index.firing, false);
  });

  it("fires when the failure keeps coming back in consecutive turns", () => {
    const entries = [1, 2, 3].flatMap((turn) => [promptAt(turn), errorAt(turn)]);
    const index = computeIndex([...entries, promptAt(4)], thresholds);
    assert.equal(index.firing, true);
    assert.equal(index.error?.count, 3);
  });
});
