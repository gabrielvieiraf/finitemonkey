import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { JsonObject } from "../src/core/parsed.js";
import { regressionCheck } from "../src/gate/checks/regression.js";
import { testsCheck } from "../src/gate/checks/tests.js";
import { prepareGate } from "../src/gate/prepare.js";
import type { GateContext } from "../src/gate/types.js";
import { expiryFrom, saveRelease } from "../src/guards/release/grants.js";
import { countTestsAst } from "../src/guards/tests/ast-count.js";
import { countTests } from "../src/guards/tests/scan.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { loadTypescript } from "../src/quality/ts-api.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";
import { ROOT, stdinFrom } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const SUM = "exports.sum = (a, b) => a - b;\n";
const SUM_TEST = [
  'const { test } = require("node:test");',
  'const assert = require("node:assert");',
  'const { sum } = require("../src/sum.js");',
  'test("sums", () => { assert.equal(sum(2, 2), 4); });',
  "",
].join("\n");

const project = (): Repo => {
  const repo = makeRepo({
    "package.json": '{ "scripts": { "test": "node --test" } }\n',
    "src/sum.js": "exports.sum = (a, b) => a + b;\n",
    "test/a.test.js": PASSING_TEST,
  });
  repos.push(repo);
  return repo;
};

const edit = (repo: Repo, file: string, content: string) => {
  const runtime = repoRuntime();
  const payload: JsonObject = {
    hook_event_name: "PreToolUse",
    session_id: "s1",
    cwd: repo.root,
    tool_name: "Write",
    tool_input: { file_path: join(repo.root, file), content },
  };
  return runHook("PreToolUse", {
    stdin: stdinFrom(JSON.stringify(payload)),
    deadlineMs: 5000,
    handlers: DEFAULT_HANDLERS,
    cwd: repo.root,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });
};

const task = (repo: Repo, goal: string, paths: readonly string[] = []): void => {
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
    id: "t1",
    goal,
    size: "S",
    base: repo.git("rev-parse", "HEAD").trim(),
    paths,
    runs: [],
    tests: "node --test",
    git: [],
    manual: [],
    budget: undefined,
  });
  assert.ok(created.ok);
};

const context = (repo: Repo): GateContext => {
  const ready = prepareGate({
    runtime: repoRuntime(),
    cwd: repo.root,
    env: {},
    sessionId: "s1",
    budgetMs: 60_000,
    fast: false,
    noSkip: true,
  });
  if (ready.kind !== "ready") throw new Error(`not ready: ${ready.kind}`);
  return ready.prepared.ctx;
};

const WEAKER = PASSING_TEST.replace("assert.equal(1 + 1, 2); ", "");

describe("edits to existing tests are held", () => {
  it("holds an edit to an unlisted test until the person approves it", async () => {
    const repo = project();
    const held = await edit(repo, "test/a.test.js", `${PASSING_TEST}\n`);
    assert.equal(held.verdict, "block");
    assert.match(held.stdout, /If the test looks wrong, stop and say so instead of changing it/);
    const now = Date.now();
    saveRelease(repoRuntime(), fmPaths(repo.root), now, {
      grants: [
        {
          guard: "tests",
          reason: "the old test asserted a bug",
          grantedAt: new Date(now).toISOString(),
          expiresAt: expiryFrom(now),
        },
      ],
      approvals: [],
    });
    assert.equal((await edit(repo, "test/a.test.js", `${PASSING_TEST}\n`)).verdict, "allow");
  });

  it("lets new tests through, then edits to them, and edits to tests the contract lists", async () => {
    const repo = project();
    assert.equal((await edit(repo, "test/b.test.js", PASSING_TEST)).verdict, "allow");
    repo.write("test/b.test.js", PASSING_TEST);
    assert.equal((await edit(repo, "test/b.test.js", `${PASSING_TEST}\n`)).verdict, "allow");
    task(repo, "change a", ["test/a.test.js"]);
    assert.equal((await edit(repo, "test/a.test.js", `${PASSING_TEST}\n`)).verdict, "allow");
  });

  it("only warns in shadow mode", async () => {
    const repo = project();
    repo.write(".finitemonkey/policy.yml", "guards:\n  tests-hold: shadow\n");
    assert.equal((await edit(repo, "test/a.test.js", `${PASSING_TEST}\n`)).verdict, "allow");
  });

  it("the gate lists every test edit with a diff summary and assertion counts from the AST", () => {
    const repo = project();
    task(repo, "change a");
    repo.write("test/a.test.js", WEAKER);
    const outcome = testsCheck({ id: "tests", kind: "tests" }, context(repo));
    assert.equal(outcome.status, "failed");
    const keys = outcome.notes.map((item) => item.key);
    assert.ok(keys.includes("gate.tests.test_edited"));
    assert.ok(keys.includes("gate.tests.assertion_removed"));
    const summary = outcome.notes.find((item) => item.key === "gate.tests.edited");
    assert.deepEqual(summary?.params, { file: "test/a.test.js", added: 1, removed: 1, before: 2, after: 1 });
  });
});

describe("assertions are counted by AST", () => {
  it("counts calls to expect, assert and t, not lookalikes in other objects", () => {
    const ts = loadTypescript(ROOT);
    assert.ok(ts !== undefined);
    const source = [
      'test("a", () => {',
      "  expect(a).toBe(1);",
      "  assert.equal(b, 2);",
      "  logger.assert(c);",
      "});",
      'it.skip("b", () => {});',
      "",
    ].join("\n");
    assert.deepEqual(countTestsAst(ts, "a.test.ts", source), { tests: 2, skips: 1, assertions: 2 });
    assert.equal(countTests("js", source).assertions, 3);
  });
});

describe("a test added for a bug fix must fail on the base commit", () => {
  it("proves the fix when the new test fails on the base commit", () => {
    const repo = project();
    repo.write("src/sum.js", SUM);
    repo.commit("bug");
    task(repo, "fix the sum");
    repo.write("src/sum.js", "exports.sum = (a, b) => a + b;\n");
    repo.write("test/sum.test.js", SUM_TEST);
    const outcome = regressionCheck({ id: "regression", kind: "regression" }, context(repo));
    assert.equal(outcome.status, "passed");
    assert.equal(outcome.notes[0]?.key, "gate.regression.proven");
  });

  it("reports a new test that passes on the base commit as not proving the fix", () => {
    const repo = project();
    task(repo, "fix the sum");
    repo.write("test/sum.test.js", SUM_TEST);
    const outcome = regressionCheck({ id: "regression", kind: "regression" }, context(repo));
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.notes[0]?.key, "gate.regression.not_proven");
  });

  it("does not run for a task that is not a fix", () => {
    const repo = project();
    task(repo, "add a sum page");
    repo.write("test/sum.test.js", SUM_TEST);
    const outcome = regressionCheck({ id: "regression", kind: "regression" }, context(repo));
    assert.equal(outcome.notes[0]?.key, "gate.regression.not_fix");
  });
});
