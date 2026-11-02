import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { Arm } from "../scripts/bench-arms.js";
import { pilotChecklist, pilotProblems, preregTag, readPilotState, realGit } from "../scripts/bench-pilot-lib.js";
import type { Freeze } from "../scripts/bench-prereg.js";

const FREEZE: Freeze = { sha256: "a".repeat(64), frozenAt: "2026-10-29", personas: { "senior.json": "b".repeat(64) } };

const arm = (id: string, finitemonkey: boolean, sha: string | undefined): Arm => ({
  id,
  description: id,
  finitemonkey,
  sha,
  guards: {},
});

const PINNED = [arm("plain", false, undefined), arm("fm", true, "c".repeat(40))];

const git = (dir: string, args: readonly string[]): void => {
  const run = spawnSync(
    "git",
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { cwd: dir, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
};

const withRepo = (body: (dir: string, benchDir: string) => void): void => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-pilot-")));
  try {
    const benchDir = join(dir, "bench");
    mkdirSync(benchDir);
    writeFileSync(join(benchDir, "PREREGISTRATION.lock.json"), '{"frozen":1}\n');
    git(dir, ["init", "-q"]);
    git(dir, ["add", "."]);
    git(dir, ["commit", "-q", "-m", "chore: freeze"]);
    body(dir, benchDir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("pre-pilot checklist", () => {
  it("refuses the pilot without the pre-registration tag", () => {
    withRepo((dir, benchDir) => {
      const state = readPilotState(benchDir, FREEZE, PINNED, realGit(dir));
      assert.equal(state.tagCommit, undefined);
      assert.deepEqual(pilotProblems(state), [
        "the pre-registration tag bench-prereg-2026-10-29 does not exist; tag the freeze commit before the pilot",
      ]);
      assert.ok(pilotChecklist(state).includes("tag bench-prereg-2026-10-29: missing"));
    });
  });

  it("accepts a tag on the freeze commit with every plugin arm pinned", () => {
    withRepo((dir, benchDir) => {
      git(dir, ["tag", preregTag(FREEZE)]);
      const state = readPilotState(benchDir, FREEZE, PINNED, realGit(dir));
      assert.deepEqual(pilotProblems(state), []);
      assert.ok(pilotChecklist(state).includes(`arm fm: ${"c".repeat(40)}`));
      assert.ok(pilotChecklist(state).includes(`persona senior.json: ${"b".repeat(64)}`));
    });
  });

  it("refuses a tag that points at an older lock, and an unpinned plugin arm", () => {
    withRepo((dir, benchDir) => {
      git(dir, ["tag", preregTag(FREEZE)]);
      writeFileSync(join(benchDir, "PREREGISTRATION.lock.json"), '{"frozen":2}\n');
      const state = readPilotState(benchDir, FREEZE, [arm("fm", true, undefined)], realGit(dir));
      const problems = pilotProblems(state);
      assert.equal(problems.length, 2);
      assert.match(problems[0] ?? "", /does not point at a commit with the current/);
      assert.match(problems[1] ?? "", /arm fm has no pinned sha/);
    });
  });
});
