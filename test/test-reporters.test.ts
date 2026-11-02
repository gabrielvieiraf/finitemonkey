import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { loadBaseline, saveBaseline, withEntry } from "../src/findings/baseline.js";
import { findFinding } from "../src/findings/sources.js";
import { testBudgetCheck } from "../src/gate/checks/test-budget.js";
import { testsCheck } from "../src/gate/checks/tests.js";
import { prepareGate } from "../src/gate/prepare.js";
import type { GateContext } from "../src/gate/types.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { parseReport, type Runner, runnerOf, withReporter } from "../src/testbudget/reporters.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, "fixtures", "reporters", name), "utf8");

const timings = (runner: Runner, name: string) =>
  parseReport(runner, fixture(name), "/repo").map((item) => [item.file, item.name, item.ms]);

describe("runner reporters", () => {
  it("reads per-test durations from the reporter of each of the four runners", () => {
    assert.deepEqual(timings("node", "node-junit.xml"), [
      ["test/math.test.mjs", "math > adds & sums", 2],
      ["test/math.test.mjs", "math > slow one", 1235],
      ["test/math.test.mjs", "top level", 1],
    ]);
    assert.deepEqual(timings("pytest", "pytest-junit.xml"), [
      ["tests.test_math", "test_adds", 1],
      ["tests.test_math.TestSlow", "test_slow", 1250],
      ["tests.test_math", "test_fails", 4],
    ]);
    assert.deepEqual(timings("vitest", "vitest.json"), [
      ["test/math.test.ts", "math adds", 3],
      ["test/math.test.ts", "math slow one", 1250],
      ["test/other.test.ts", "top level", 1],
    ]);
    assert.deepEqual(timings("jest", "jest.json"), [
      ["src/math.test.js", "math adds", 2],
      ["src/math.test.js", "math slow one", 1251],
    ]);
    assert.deepEqual(parseReport("jest", "not json", "/repo"), []);
  });

  it("adds the reporter only to a single runner command it recognizes", () => {
    assert.equal(runnerOf("node --test"), "node");
    assert.equal(runnerOf("npx vitest run"), "vitest");
    assert.equal(runnerOf("npx jest --ci"), "jest");
    assert.equal(runnerOf("python3 -m pytest -q"), "pytest");
    assert.equal(runnerOf("uv run pytest"), "pytest");
    assert.equal(runnerOf("npm test"), undefined);
    assert.equal(runnerOf("node --test && echo done"), undefined);
    assert.equal(runnerOf("npx vitest run --reporter=json"), undefined);
    assert.equal(runnerOf("node --test --test-reporter=tap"), undefined);
    assert.equal(
      withReporter("node --test test/", "node", "/c/r.xml"),
      "node --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=/c/r.xml --test test/",
    );
    assert.equal(withReporter("pytest -q", "pytest", "/c/r.xml"), "pytest -q --junitxml=/c/r.xml");
    assert.equal(withReporter("jest", "jest", "/c/r.json"), "jest --json --outputFile=/c/r.json");
    assert.equal(
      withReporter("vitest run", "vitest", "/c dir/r.json"),
      'vitest run --reporter=default --reporter=json --outputFile.json="/c dir/r.json"',
    );
  });
});

const TEST_HEAD =
  'import { test } from "node:test";\nconst wait = (ms) => new Promise((done) => setTimeout(done, ms));\n';

const project = (): Repo => {
  const repo = makeRepo({
    ".gitignore": ".finitemonkey/*\n!.finitemonkey/config.yml\n!.finitemonkey/policy.yml\n",
    ".finitemonkey/config.yml": "lang: en\ntest_budget:\n  slow_test_ms: 300\n",
    ".finitemonkey/policy.yml": "guards:\n  test-budget: active\n",
    "package.json": '{"type": "module"}\n',
    "test/a.test.mjs": `${TEST_HEAD}test("fast", () => {});\ntest("slow one", () => wait(450));\n`,
  });
  repos.push(repo);
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
    id: "t1",
    goal: "speed",
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

const gate = (repo: Repo) => {
  const ready = prepareGate({
    runtime: repoRuntime(),
    cwd: repo.root,
    env: {},
    sessionId: "s1",
    budgetMs: 120_000,
    fast: false,
    noSkip: true,
  });
  if (ready.kind !== "ready") throw new Error(ready.kind);
  const ctx: GateContext = { ...ready.prepared.ctx, trusted: true };
  const tests = testsCheck({ id: "tests", kind: "tests", run: "node --test" }, ctx);
  assert.equal(tests.status, "passed");
  assert.equal(tests.command, "node --test");
  return testBudgetCheck({ id: "test-budget", kind: "test-budget" }, ctx);
};

const slowTests = (outcome: ReturnType<typeof gate>) =>
  outcome.notes.filter((item) => item.key === "gate.test_budget.slow_test").map((item) => item.params["test"]);

describe("slow tests ratchet", () => {
  it("a new slow test above the baseline is reported; one already in the baseline is not", () => {
    const repo = project();
    repo.write("src/x.mjs", "export const x = 1;\n");
    const first = gate(repo);
    assert.equal(first.status, "failed");
    assert.deepEqual(slowTests(first), ["slow one"]);

    const runtime = repoRuntime();
    const root = toAbsolutePath(repo.root);
    const id = String(first.notes.find((item) => item.key === "gate.test_budget.slow_test")?.params["id"]);
    const finding = findFinding(runtime, root, id);
    assert.ok(finding);
    const baseline = loadBaseline(runtime, root);
    assert.ok(baseline.ok);
    const entry = {
      ...finding,
      state: "aceito" as const,
      owner: "person",
      reason: "known slow fixture",
      acceptedAt: "2026-10-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    assert.ok(saveBaseline(runtime, root, withEntry(baseline.value, entry)).ok);

    const second = gate(repo);
    assert.equal(second.status, "passed");
    assert.deepEqual(slowTests(second), []);
    assert.ok(second.notes.some((item) => item.key === "gate.test_budget.known"));

    repo.write("test/b.test.mjs", `${TEST_HEAD}test("new slow", () => wait(450));\n`);
    const third = gate(repo);
    assert.equal(third.status, "failed");
    assert.deepEqual(slowTests(third), ["new slow"]);
  });
});
