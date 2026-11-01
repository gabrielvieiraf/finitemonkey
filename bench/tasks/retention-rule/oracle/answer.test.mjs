import assert from "node:assert/strict";
import { test } from "node:test";

import { citedSources, note, sourcesUnchanged } from "./note.mjs";

test("answer.md gives a bottom line and cites at least three sources", () => {
  const text = note();
  assert.match(text, /^\W*bottom line\W*:/im);
  assert.ok(citedSources(text).length >= 3, citedSources(text).join(", "));
});

test("the sources are untouched", () => {
  assert.equal(sourcesUnchanged(), true);
});
