import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixedSignatures } from "../src/learnings/learn.js";
import { clipWords, MAX_TEXT, newLesson } from "../src/learnings/store.js";
import type { SignalEntry } from "../src/signals/store.js";

const AT = "2026-11-03T21:06:16.859Z";
const base = { at: AT, session: "s1", turn: 1 } as const;
const EISDIR = "EISDIR: illegal operation on a directory, read '/home/ana/project/.finitemonkey'";
const MISSING = "File does not exist. Note: your current working directory is /home/ana/project.";
const HOOKS = "../../../../../../../home/ana/.claude/plugins/cache/finitemonkey/finitemonkey/0.1.0/hooks/hooks.json";

const error = (tool: string, sample: string, sig: string): SignalEntry => ({
  ...base,
  kind: "error",
  tool,
  sig,
  sample,
});
const edit = (file: string): SignalEntry => ({ ...base, kind: "edit", file, hash: file, undo: false });
const run: SignalEntry = { ...base, kind: "run", tool: "Bash" };

describe("learnings: only a project edit after a repeated command failure becomes a cause", () => {
  it("learns nothing from a Read of a directory or of a missing file, even after a project edit", () => {
    const entries = [
      error("Read", EISDIR, "8523"),
      error("Read", EISDIR, "8523"),
      error("Read", MISSING, "4306"),
      error("Read", MISSING, "4306"),
      edit("src/app.ts"),
      run,
    ];
    assert.deepEqual(fixedSignatures(entries), []);
  });

  it("never credits an edit outside the project", () => {
    const entries = [
      error("Bash", "TypeError: cannot read properties of undefined", "a1b2"),
      error("Bash", "TypeError: cannot read properties of undefined", "a1b2"),
      edit(HOOKS),
      edit("/home/ana/.claude/settings.json"),
      run,
    ];
    assert.deepEqual(fixedSignatures(entries), []);
  });

  it("credits only the project files when both kinds of edit follow", () => {
    const entries = [
      error("Bash", "TypeError: cannot read properties of undefined", "a1b2"),
      error("Bash", "TypeError: cannot read properties of undefined", "a1b2"),
      edit(HOOKS),
      edit("src/pay.ts"),
      run,
    ];
    assert.deepEqual(
      fixedSignatures(entries).map((fixed) => fixed.files),
      [["src/pay.ts"]],
    );
  });
});

describe("learnings: text is never cut mid-word", () => {
  it("clips at a word boundary and marks the cut", () => {
    assert.equal(clipWords("check that change before trying something else", 40), "check that change before trying…");
    assert.equal(clipWords("short", 40), "short");
  });

  it("keeps a long lesson within the limit and ending on a whole word", () => {
    const words = "check that change before trying something else ".repeat(10);
    const lesson = newLesson({ text: words, paths: [], sig: "a1b2", source: "signature" }, AT);
    assert.ok(lesson.text.length <= MAX_TEXT);
    assert.match(lesson.text, /(?:^|\s)\S+…$/);
    assert.ok(words.startsWith(lesson.text.slice(0, -1)));
    assert.match(lesson.text.slice(0, -1), /\b(?:check|that|change|before|trying|something|else)$/);
  });
});
