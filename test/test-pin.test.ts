import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { readLedger } from "../src/evidence/ledger.js";
import { runGate } from "../src/gate/run.js";
import { looksLikeTest, masksExit, scriptsRun } from "../src/gate/test-pin.js";
import { saveRelease } from "../src/guards/release/grants.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const ACTIVE = "guards:\n  test-pin: active\n";
const PACKAGE = (test: string): string => `${JSON.stringify({ name: "x", scripts: { test } }, null, 2)}\n`;
const MORE_TESTS = PASSING_TEST.replace('test("keeps"', 'test("third", () => {});\ntest("keeps"');

const fresh = (files: Readonly<Record<string, string>> = {}, policy = ACTIVE): Repo => {
  const repo = makeRepo({
    "src/a.js": "export const a = 1;\n",
    "test/a.test.js": PASSING_TEST,
    "package.json": PACKAGE("node --test"),
    ".finitemonkey/policy.yml": policy,
    ...files,
  });
  repos.push(repo);
  return repo;
};

const task = (repo: Repo, runs: readonly string[]): void => {
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
    id: "t1",
    goal: "change a",
    size: "S",
    base: repo.git("rev-parse", "HEAD").trim(),
    paths: [],
    runs,
    tests: undefined,
    git: [],
    manual: [],
    budget: undefined,
  });
  assert.ok(created.ok);
};

const item = (repo: Repo, id: string) => {
  const run = runGate({
    runtime: repoRuntime(),
    cwd: repo.root,
    env: {},
    sessionId: "s1",
    budgetMs: 60_000,
    fast: false,
  });
  if (run.kind !== "done") throw new Error(`gate did not run: ${JSON.stringify(run)}`);
  const found = run.report.items.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no ${id} in the report`);
  return found;
};

describe("test pinning", () => {
  it("recognizes test commands, masked exits and the scripts a package runner calls", () => {
    assert.ok(looksLikeTest("npm test"));
    assert.ok(looksLikeTest("pytest -q"));
    assert.ok(!looksLikeTest("npm run lint"));
    assert.ok(masksExit("npm test || true"));
    assert.ok(masksExit("pytest; exit 0"));
    assert.ok(!masksExit("npm test && npm run lint"));
    assert.deepEqual(scriptsRun("npm test"), ["test"]);
    assert.deepEqual(scriptsRun("pnpm run unit -- --watch=false"), ["unit"]);
    assert.deepEqual(scriptsRun("yarn e2e"), ["e2e"]);
  });

  it("redefining scripts.test during a task holds the check until the person approves", () => {
    const repo = fresh();
    task(repo, ["npm test"]);
    repo.write("package.json", PACKAGE('echo "# tests 9"'));
    const held = item(repo, "C1");
    assert.equal(held.status, "unverified");
    assert.equal(held.reason, "needs_approval");
    assert.ok(
      held.notes.some((note) => note.key === "gate.pin.changed" && note.params["key"] === "package.json scripts.test"),
    );
    saveRelease(repoRuntime(), fmPaths(repo.root), Date.now(), {
      grants: [],
      approvals: [{ task: "t1", check: "C1", reason: "new runner", at: new Date().toISOString() }],
    });
    assert.equal(item(repo, "C1").status, "passed");
  });

  it("a changed CI workflow holds a test command, but not a lint command", () => {
    const repo = fresh({ ".github/workflows/ci.yml": "on: push\n" });
    task(repo, ["node --test", "node -e 0"]);
    repo.write(".github/workflows/ci.yml", "on: [push, pull_request]\n");
    assert.equal(item(repo, "C1").reason, "needs_approval");
    assert.notEqual(item(repo, "C2").reason, "needs_approval");
  });

  it("`npm test || true` and a test run with no summary are unverified", () => {
    const repo = fresh({ "scripts/test.js": 'console.log("all good");\n' });
    task(repo, ["npm test || true", "node scripts/test.js"]);
    repo.write("src/a.js", "export const a = 2;\n");
    const masked = item(repo, "C1");
    assert.equal(masked.status, "unverified");
    assert.equal(masked.reason, "masked_exit");
    const silent = item(repo, "C2");
    assert.equal(silent.status, "unverified");
    assert.equal(silent.reason, "no_test_count");
  });

  it("fewer executed tests than the first run of the task fails the check", () => {
    const repo = fresh({ "test/a.test.js": MORE_TESTS });
    task(repo, ["node --test"]);
    repo.write("src/a.js", "export const a = 2;\n");
    assert.equal(item(repo, "C1").status, "passed");
    const ledger = readLedger(repoRuntime(), fmPaths(repo.root).evidence("t1"));
    assert.equal(ledger.find((entry) => entry.check === "C1")?.testCount, 3);
    repo.write("test/a.test.js", PASSING_TEST);
    const dropped = item(repo, "C1");
    assert.equal(dropped.status, "failed");
    assert.ok(
      dropped.notes.some(
        (note) => note.key === "gate.pin.count_drop" && note.params["before"] === 3 && note.params["after"] === 2,
      ),
    );
  });

  it("a new exit(0) outside tests fails a passing test command", () => {
    const repo = fresh();
    task(repo, ["node --test"]);
    repo.write("src/a.js", "export const a = 2;\nprocess.exit(0);\n");
    const exited = item(repo, "C1");
    assert.equal(exited.status, "failed");
    assert.ok(exited.notes.some((note) => note.key === "gate.pin.exit_zero" && note.params["where"] === "src/a.js:2"));
  });

  it("in shadow the check keeps its real result and notes what pinning would have done", () => {
    const repo = fresh({}, "guards:\n  test-pin: shadow\n");
    task(repo, ["npm test"]);
    repo.write("package.json", PACKAGE("node --test"));
    repo.write("src/a.js", "export const a = 2;\nprocess.exit(0);\n");
    const shadow = item(repo, "C1");
    assert.equal(shadow.status, "passed");
    assert.ok(shadow.notes.some((note) => note.key === "gate.pin.shadow"));
  });
});
