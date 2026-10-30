import assert from "node:assert/strict";
import { test } from "node:test";

import { inBase, load, vars, inWork } from "./support.mjs";

test("the source that was already right is unchanged", () => {
  assert.equal(inWork("src/leap.js"), inBase("src/leap.js"));
});

test("behaves like the Gregorian rule", () => {
  const leap = load("src/leap.js")[vars.fn];
  for (let year = -400; year <= 2400; year += 1) {
    assert.equal(leap(year), (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0, String(year));
  }
});
