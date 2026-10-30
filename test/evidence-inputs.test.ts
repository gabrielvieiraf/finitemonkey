import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { Env } from "../src/core/context.js";
import type { Runtime } from "../src/core/runtime.js";
import { readLedger } from "../src/evidence/ledger.js";
import { inputsChanged } from "../src/gate/inputs.js";
import { runGate } from "../src/gate/run.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const fresh = (): Repo => {
  const repo = makeRepo({
    "src/a.js": "export const a = 1;\n",
    "test/a.test.js": PASSING_TEST,
    "package.json": '{ "name": "x" }\n',
    ".gitignore": "package-lock.json\n",
  });
  repos.push(repo);
  repo.write("package-lock.json", '{ "lockfileVersion": 3 }\n');
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
    id: "t1",
    goal: "change a",
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
  repo.write("src/a.js", "export const a = 2;\n");
  return repo;
};

const withNode = (version: string, base: Runtime = repoRuntime()): Runtime => ({
  ...base,
  exec: (request) =>
    request.command === "node" && request.args[0] === "--version"
      ? { found: true, exitCode: 0, stdout: `${version}\n`, stderr: "", timedOut: false, durationMs: 1 }
      : base.exec(request),
});

const runs = (repo: Repo, runtime: Runtime = repoRuntime(), env: Env = {}): number => {
  const run = runGate({ runtime, cwd: repo.root, env, sessionId: "s1", budgetMs: 60_000, fast: false });
  if (run.kind !== "done") throw new Error(`gate did not run: ${JSON.stringify(run)}`);
  return readLedger(repoRuntime(), fmPaths(repo.root).evidence("t1")).filter((entry) => entry.check === "tests").length;
};

describe("evidence freshness", () => {
  it("green evidence is reused while nothing changes", () => {
    const repo = fresh();
    assert.equal(runs(repo), 1);
    assert.equal(runs(repo), 1);
  });

  it("a lockfile change invalidates green evidence, and evidence why names it", async () => {
    const repo = fresh();
    assert.equal(runs(repo), 1);
    repo.write("package-lock.json", '{ "lockfileVersion": 3, "packages": {} }\n');
    const { body } = await cliJson(["evidence", "why", "tests"], { cwd: repo.root, runtime: repoRuntime() });
    assert.deepEqual(field(body, "data", "changed"), ["lockfile:package-lock.json"]);
    assert.equal(runs(repo), 2);
    const after = await cliJson(["evidence", "why", "tests"], { cwd: repo.root, runtime: repoRuntime() });
    assert.deepEqual(field(after.body, "data", "changed"), []);
  });

  it("a different Node version invalidates green evidence", () => {
    const repo = fresh();
    assert.equal(runs(repo, withNode("v22.0.0")), 1);
    assert.equal(runs(repo, withNode("v22.0.0")), 1);
    assert.equal(runs(repo, withNode("v24.1.0")), 2);
  });

  it("an allowlisted variable invalidates green evidence; others do not", () => {
    const repo = fresh();
    assert.equal(runs(repo, repoRuntime(), { NODE_ENV: "test" }), 1);
    assert.equal(runs(repo, repoRuntime(), { NODE_ENV: "test", UNRELATED: "x" }), 1);
    assert.equal(runs(repo, repoRuntime(), { NODE_ENV: "production" }), 2);
  });

  it("command evidence older than the maximum age runs again", () => {
    const repo = fresh();
    const start = Date.now();
    const at = (minutes: number): Runtime =>
      repoRuntime({ now: () => new Date(start + minutes * 60_000).toISOString() });
    assert.equal(runs(repo, at(0)), 1);
    assert.equal(runs(repo, at(30)), 1);
    assert.equal(runs(repo, at(61)), 2);
  });

  it("with evidence-inputs off, inputs are ignored", () => {
    const repo = fresh();
    repo.write(".finitemonkey/policy.yml", "guards:\n  evidence-inputs: off\n");
    assert.equal(runs(repo, withNode("v22.0.0")), 1);
    assert.equal(runs(repo, withNode("v24.1.0")), 1);
  });

  it("evidence without recorded inputs counts as changed", () => {
    assert.deepEqual(inputsChanged(undefined, { cwd: "/x", lockfiles: {}, tools: {}, env: {} }), ["inputs"]);
  });
});
