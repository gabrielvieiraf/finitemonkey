import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { Runtime } from "../src/core/runtime.js";
import { frozenInstall } from "../src/gate/isolated.js";
import { git, type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cli, cliJson, execResult, field } from "./support.js";

const USES_HELPER = [
  'const { test } = require("node:test");',
  'const assert = require("node:assert");',
  'test("helper", () => { assert.equal(require("../helper.js").value, 1); });',
  "",
].join("\n");

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const project = (files: Readonly<Record<string, string>> = {}): TempRepo => {
  const repo = tempRepo({ "src/a.js": "module.exports = 1;\n", "test/a.test.js": USES_HELPER, ...files });
  repos.push(repo);
  return repo;
};

const leftovers = (repo: TempRepo): readonly string[] => {
  const dir = join(repo.root, ".claude", "worktrees");
  const worktrees = git(repo.root, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "));
  return [...(existsSync(dir) ? readdirSync(dir) : []), ...worktrees.slice(1)];
};

const testsStatus = (body: unknown): unknown => {
  const items = field(body, "data", "items");
  return Array.isArray(items)
    ? field(
        items.find((item) => field(item, "id") === "tests"),
        "status",
      )
    : undefined;
};

const gate = async (repo: TempRepo, extra: readonly string[], runtime: Runtime = repoRuntime()) => {
  await cli(["task", "new", "t", "--goal", "g", "--tests", "node --test"], { cwd: repo.root, runtime });
  write(repo.root, "src/a.js", "module.exports = 2;\n");
  return cliJson(["gate", ...extra], { cwd: repo.root, runtime });
};

describe("gate --isolated", () => {
  it("an untracked file that makes a test pass helps in place but not in isolated mode", async () => {
    const repo = project();
    write(repo.root, "helper.js", "module.exports = { value: 1 };\n");
    const inPlace = await gate(repo, []);
    assert.equal(testsStatus(inPlace.body), "passed");
    const isolated = await cliJson(["gate", "--isolated"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(testsStatus(isolated.body), "failed");
    assert.deepEqual(leftovers(repo), []);
  });

  it("runs the current commit plus the staged diff and ties evidence to that tree", async () => {
    const repo = project();
    write(repo.root, "helper.js", "module.exports = { value: 1 };\n");
    git(repo.root, "add", "helper.js");
    const run = await gate(repo, ["--isolated"]);
    assert.equal(testsStatus(run.body), "passed");
    assert.match(String(field(run.body, "data", "treeHash")), /^w[0-9a-f]{16}$/);
    assert.deepEqual(leftovers(repo), []);
  });

  it("removes the temporary worktree when the frozen install fails", async () => {
    const repo = project({ "package-lock.json": "{}\n" });
    const base = repoRuntime();
    const runtime: Runtime = {
      ...base,
      exec: (request) =>
        request.command === "npm ci" ? execResult(1, "", "lockfile out of sync") : base.exec(request),
    };
    const run = await gate(repo, ["--isolated"], runtime);
    assert.equal(field(run.body, "error", "code"), "gate_not_run");
    assert.match(String(field(run.body, "error", "message")), /install: npm ci: lockfile out of sync/);
    assert.deepEqual(leftovers(repo), []);
  });

  it("refuses when the policy turns the feature off", async () => {
    const repo = project();
    write(repo.root, ".finitemonkey/policy.yml", "guards:\n  gate-isolated: off\n");
    const run = await gate(repo, ["--isolated"]);
    assert.equal(field(run.body, "error", "code"), "gate_not_run");
    assert.match(String(field(run.body, "error", "message")), /gate-isolated is off/);
  });

  it("picks the frozen install command from the lockfile", () => {
    const has =
      (...files: readonly string[]) =>
      (file: string): boolean =>
        files.includes(file);
    assert.equal(frozenInstall(has("package-lock.json")), "npm ci");
    assert.equal(frozenInstall(has("pnpm-lock.yaml", "package-lock.json")), "pnpm install --frozen-lockfile");
    assert.equal(frozenInstall(has("uv.lock")), "uv sync --locked");
    assert.equal(frozenInstall(has()), undefined);
  });
});
