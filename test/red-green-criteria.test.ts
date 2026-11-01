import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { ExecRequest } from "../src/core/runtime.js";
import { redGreenCheck } from "../src/gate/checks/red-green.js";
import { prepareGate } from "../src/gate/prepare.js";
import type { GateContext } from "../src/gate/types.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { contractYaml } from "../src/task/serialize.js";
import type { AcceptanceCheck } from "../src/task/types.js";
import { validateContract } from "../src/task/validate.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const SINGLE = "node --test test/add.test.mjs";

const project = (): Repo => {
  const repo = makeRepo({
    ".gitignore": ".finitemonkey/*\n!.finitemonkey/policy.yml\n",
    ".finitemonkey/policy.yml": "guards:\n  red-green: active\n",
    "package.json": '{"type": "module"}\n',
    "src/math.mjs": "export const add = (a, b) => 0;\n",
  });
  repos.push(repo);
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
    id: "t1",
    goal: "add numbers",
    size: "S",
    base: repo.git("rev-parse", "HEAD").trim(),
    paths: [],
    runs: [SINGLE],
    tests: "node --test",
    git: [],
    manual: [],
    budget: undefined,
  });
  assert.ok(created.ok);
  return repo;
};

const check = (repo: Repo, first: (item: AcceptanceCheck) => boolean, seen: string[]) => {
  const base = repoRuntime();
  const runtime = {
    ...base,
    exec: (request: ExecRequest) => {
      seen.push(request.command);
      return base.exec(request);
    },
  };
  const ready = prepareGate({
    runtime,
    cwd: repo.root,
    env: {},
    sessionId: "s1",
    budgetMs: 120_000,
    fast: false,
    noSkip: true,
  });
  if (ready.kind !== "ready") throw new Error(ready.kind);
  const contract = ready.prepared.ctx.contract;
  const acceptance = contract.acceptance.map((item) => (first(item) ? { ...item, testsFirst: true } : item));
  const ctx: GateContext = { ...ready.prepared.ctx, contract: { ...contract, acceptance }, trusted: true };
  return redGreenCheck({ id: "red-green", kind: "red-green" }, ctx);
};

const NEVER_RED =
  'import { test } from "node:test";\nimport assert from "node:assert/strict";\n' +
  'import { add } from "../src/math.mjs";\ntest("zero", () => assert.equal(add(0, 0), 0));\n';

describe("red before green per criterion", () => {
  it("a criterion keeps tests_first through validation and serialization", () => {
    const parsed = validateContract({
      id: "t1",
      goal: "g",
      acceptance: [
        { id: "C1", check: "command", run: SINGLE, tests_first: true },
        { id: "tests", check: "tests", run: "node --test" },
      ],
    });
    assert.ok(parsed.ok);
    assert.deepEqual(
      parsed.value.acceptance.map((item) => item.testsFirst === true),
      [true, false],
    );
    assert.ok(JSON.stringify(contractYaml(parsed.value)).includes('"tests_first":true'));
    assert.ok(
      !validateContract({ id: "t1", goal: "g", acceptance: [{ id: "C1", check: "tests", tests_first: 1 }] }).ok,
    );
  });

  it("a contract with one tests_first criterion holds only that criterion without a red entry", () => {
    const repo = project();
    repo.write("test/add.test.mjs", NEVER_RED);
    repo.write("src/math.mjs", "export const add = (a, b) => a + b;\n");
    const seen: string[] = [];
    const outcome = check(repo, (item) => item.id === "C1", seen);
    assert.equal(outcome.status, "failed");
    assert.deepEqual(
      outcome.notes.map((item) => [item.key, item.params["criterion"] ?? ""]),
      [
        ["gate.red_green.criterion", "C1"],
        ["gate.red_green.never_red", ""],
      ],
    );
    assert.deepEqual(
      [...new Set(seen)].filter((command) => command !== "git"),
      [SINGLE],
    );
  });

  it("without a tests_first criterion nothing is required and nothing runs", () => {
    const repo = project();
    repo.write("test/add.test.mjs", NEVER_RED);
    const seen: string[] = [];
    const outcome = check(repo, () => false, seen);
    assert.equal(outcome.status, "passed");
    assert.equal(outcome.notes[0]?.key, "gate.red_green.not_opted");
    assert.ok(!seen.includes(SINGLE));
  });
});
