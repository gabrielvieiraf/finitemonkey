import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { boardOf } from "../src/fronts/board.js";
import { writeGateStatus } from "../src/gate/hooks/status.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
});

const linked = (repo: Repo, branch: string): string => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), `fm-front-${branch}-`)));
  rmSync(dir, { recursive: true, force: true });
  repo.git("worktree", "add", "-q", "-b", branch, dir);
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
};

describe("fronts board", () => {
  it("lists three worktrees with their gate states and flags a file two fronts both changed", () => {
    const repo = makeRepo({ "src/shared.js": "export const a = 1;\n", "src/only-a.js": "1\n" });
    cleanups.push(() => {
      repo.cleanup();
    });
    const a = linked(repo, "front-a");
    const b = linked(repo, "front-b");
    writeFileSync(join(a, "src", "shared.js"), "export const a = 2;\n");
    writeFileSync(join(a, "src", "only-a.js"), "2\n");
    writeFileSync(join(b, "src", "shared.js"), "export const a = 3;\n");
    const runtime = repoRuntime();
    writeGateStatus(runtime, fmPaths(toAbsolutePath(a)), { status: "passed", task: "t1", detail: "" });
    writeGateStatus(runtime, fmPaths(toAbsolutePath(b)), { status: "failed", task: "t2", detail: "" });
    const board = boardOf(runtime, repo.root);
    assert.deepEqual(
      board.rows.map((row) => [row.branch, row.gate]),
      [
        ["main", "none"],
        ["front-a", "green"],
        ["front-b", "red"],
      ],
    );
    assert.deepEqual(board.collisions, [{ file: "src/shared.js", branches: ["front-a", "front-b"] }]);
  });
});
