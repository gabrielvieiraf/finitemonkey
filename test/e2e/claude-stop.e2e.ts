import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../../src/core/brand.js";
import { nodeRuntime } from "../../src/core/node-runtime.js";
import type { Runtime } from "../../src/core/runtime.js";
import { createTask } from "../../src/task/create.js";
import { fmPaths } from "../../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "../repo.js";
import { BUNDLE, cli, found, ROOT } from "../support.js";

const PLUGIN_ROOT = join(ROOT, "plugin");
const MODEL = process.env["FM_E2E_MODEL"] ?? "haiku";
const SUM_TEST = [
  'const { test } = require("node:test");',
  'const assert = require("node:assert");',
  'const { sum } = require("../src/sum.js");',
  'test("adds", () => { assert.equal(sum(1, 1), 2); });',
  "",
].join("\n");
const PROMPT =
  "Change src/sum.js so that sum returns x - y. Do not run any command. When a hook blocks you, read its reason and do what it asks. Answer with one word when you are done.";

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch {
      continue;
    }
  }
});

const runtime: Runtime = { ...nodeRuntime(), probe: () => found("2.1.300 (Claude Code)"), selfPath: BUNDLE };

const project = async (install: boolean): Promise<Repo> => {
  const repo = makeRepo({ "src/sum.js": "exports.sum = (x, y) => x + y;\n", "test/sum.test.js": SUM_TEST });
  cleanups.push(repo.cleanup);
  const root = toAbsolutePath(realpathSync.native(repo.root));
  if (install) {
    const init = await cli(["init", "--yes"], { cwd: root, runtime, env: {}, version: "1.0.0" });
    assert.equal(init.code, 0, init.stdout + init.stderr);
    repo.commit("install");
  }
  const created = createTask(repoRuntime(), fmPaths(root), {
    id: "t1",
    goal: "change sum",
    size: "S",
    base: repo.git("rev-parse", "HEAD").trim(),
    paths: [],
    runs: [],
    tests: "node --test",
    git: [],
    manual: [],
    budget: undefined,
  });
  assert.ok(created.ok);
  return repo;
};

const session = (repo: Repo, extra: readonly string[]): void => {
  const config = mkdtempSync(join(tmpdir(), "fm-claude-config-"));
  cleanups.push(() => {
    rmSync(config, { recursive: true, force: true });
  });
  const result = spawnSync(
    "claude",
    [
      "--print",
      PROMPT,
      "--model",
      MODEL,
      "--permission-mode",
      "acceptEdits",
      "--disallowed-tools",
      "Bash",
      "--max-budget-usd",
      "0.50",
      "--no-session-persistence",
      "--output-format",
      "json",
      ...extra,
    ],
    { cwd: repo.root, encoding: "utf8", timeout: 300_000, env: { ...process.env, CLAUDE_CONFIG_DIR: config } },
  );
  assert.notEqual(result.status, null, "claude timed out");
};

const failedAtStop = (repo: Repo): number =>
  readFileSync(join(repo.root, ".finitemonkey", "evidence", "t1.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.includes('"status":"failed"')).length;

describe("Stop through the real claude binary", () => {
  it("Stop blocks once through the plugin", async () => {
    const repo = await project(false);
    session(repo, ["--plugin-dir", PLUGIN_ROOT]);
    assert.ok(failedAtStop(repo) >= 1, "the plugin Stop hook never blocked");
  });

  it("Stop blocks once through project settings", async () => {
    const repo = await project(true);
    session(repo, []);
    assert.ok(failedAtStop(repo) >= 1, "the project Stop hook never blocked");
  });

  it("Stop blocks once through project settings with the plugin disabled", async () => {
    const repo = await project(true);
    session(repo, [
      "--plugin-dir",
      PLUGIN_ROOT,
      "--settings",
      JSON.stringify({ enabledPlugins: { "finitemonkey@inline": false } }),
    ]);
    assert.ok(failedAtStop(repo) >= 1, "the project Stop hook never blocked with the plugin disabled");
  });
});
