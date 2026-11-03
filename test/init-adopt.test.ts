import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { makeRepo, repoRuntime } from "./repo.js";
import { cli } from "./support.js";

const repo = makeRepo({ "README.md": "hello\n" });
const outside = mkdtempSync(join(tmpdir(), "fm-adopt-"));
after(() => {
  repo.cleanup();
  rmSync(outside, { recursive: true, force: true });
});

const init = (extra: readonly string[]) =>
  cli(["init", ...extra], { cwd: repo.root, runtime: repoRuntime(), env: { HOME: outside } });

describe("init offers wt adopt for existing worktrees", () => {
  it("lists untracked worktrees, adopts them only with --adopt, then stays quiet", async () => {
    repo.git("worktree", "add", "-q", "-b", "side", join(outside, "side"));
    const offered = await init(["--dry-run"]);
    assert.match(offered.stdout, /worktrees that Finite Monkey does not track yet: 1/);
    assert.match(offered.stdout, /side/);
    const adopted = await init(["--adopt"]);
    assert.match(adopted.stdout, /existing worktrees registered: 1/);
    const quiet = await init(["--dry-run"]);
    assert.doesNotMatch(quiet.stdout, /does not track yet/);
  });
});
