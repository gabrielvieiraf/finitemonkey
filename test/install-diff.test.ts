import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lineDiff } from "../src/install/diff.js";

const lines = (count: number, prefix: string): string =>
  Array.from({ length: count }, (_, index) => `${prefix} ${String(index)}`).join("\n");

describe("line diff", () => {
  it("lists only the changed lines", () => {
    assert.deepEqual(lineDiff("a.txt", "one\ntwo\nthree\n", "one\nTWO\nthree\n"), [
      "--- a.txt",
      "+++ a.txt",
      "+ TWO",
      "- two",
    ]);
  });

  it("returns nothing for equal text", () => {
    assert.deepEqual(lineDiff("a.txt", "same\n", "same\n"), []);
  });

  it("diffs two 40,000-line files that differ in the middle without running out of memory", () => {
    const head = lines(20_000, "head");
    const tail = lines(20_000, "tail");
    const diff = lineDiff("big.mjs", `${head}\nold\n${tail}\n`, `${head}\nnew\n${tail}\n`);
    assert.deepEqual(diff, ["--- big.mjs", "+++ big.mjs", "+ new", "- old"]);
  });

  it("falls back to removed then added when the changed block is too large to align", () => {
    const diff = lineDiff("big.mjs", lines(5_000, "a"), lines(5_000, "b"));
    assert.equal(diff[2], "- a 0");
    assert.equal(diff.at(-1), "… 9880 more");
  });
});
