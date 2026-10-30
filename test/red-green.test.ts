import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { parseJsonObject } from "../src/core/parsed.js";
import type { ExecRequest } from "../src/core/runtime.js";
import { classifyRed, redGreenCheck } from "../src/gate/checks/red-green.js";
import { prepareGate } from "../src/gate/prepare.js";
import type { GateContext } from "../src/gate/types.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const project = (policy: string, id = "t1"): Repo => {
  const repo = makeRepo({
    ".gitignore": ".finitemonkey/*\n!.finitemonkey/config.yml\n!.finitemonkey/policy.yml\n",
    ".finitemonkey/config.yml": "lang: en\nred_green:\n  paths: [src/**]\n",
    ".finitemonkey/policy.yml": policy,
    "package.json": '{"type": "module"}\n',
    "src/math.mjs": "export const add = (a, b) => 0;\n",
  });
  repos.push(repo);
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
    id,
    goal: "add numbers",
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

const ACTIVE = "guards:\n  red-green: active\n";

const check = (repo: Repo, seen: string[] = []) => {
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
  const ctx: GateContext = { ...ready.prepared.ctx, trusted: true };
  assert.ok(ctx.contract.acceptance.some((item) => item.kind === "red-green"));
  return redGreenCheck({ id: "red-green", kind: "red-green" }, ctx);
};

const ADD_TEST = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\n';

describe("red before green", () => {
  it("only assertion failures count as red", () => {
    assert.equal(classifyRed(1, "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal"), "red");
    assert.equal(
      classifyRed(1, "SyntaxError: The requested module does not provide an export named 'mul'"),
      "compile_only",
    );
    assert.equal(classifyRed(0, "ok"), "never_red");
  });

  it("a new test that passes on the base production files is reported as never red and held when active", () => {
    const repo = project(ACTIVE);
    repo.write(
      "test/add.test.mjs",
      `${ADD_TEST}import { add } from "../src/math.mjs";\ntest("zero", () => assert.equal(add(0, 0), 0));\n`,
    );
    repo.write("src/math.mjs", "export const add = (a, b) => a + b;\n");
    const outcome = check(repo);
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.notes[0]?.key, "gate.red_green.never_red");
  });

  it("a new test that fails on the base only with a compile error is not accepted as red", () => {
    const repo = project(ACTIVE);
    repo.write(
      "test/mul.test.mjs",
      `${ADD_TEST}import { mul } from "../src/math.mjs";\ntest("mul", () => assert.equal(mul(2, 3), 6));\n`,
    );
    repo.write("src/math.mjs", "export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n");
    assert.equal(check(repo).notes[0]?.key, "gate.red_green.compile_only");
  });

  it("a test red on the base and green on the change passes, records the arm and calls no model", () => {
    const repo = project(`${ACTIVE}experiments:\n  red-green: random\n`);
    repo.write(
      "test/add.test.mjs",
      `${ADD_TEST}import { add } from "../src/math.mjs";\ntest("sum", () => assert.equal(add(1, 2), 3));\n`,
    );
    repo.write("src/math.mjs", "export const add = (a, b) => a + b;\n");
    const seen: string[] = [];
    const outcome = check(repo, seen);
    const event = repo
      .read(join(".finitemonkey", "log.jsonl"))
      .split("\n")
      .map((line) => parseJsonObject(line))
      .flatMap((parsed) => (parsed.ok && parsed.value["event"] === "red_green" ? [parsed.value] : []))[0];
    assert.ok(event);
    assert.equal(event["outcome"], "red");
    assert.ok(event["arm"] === "active" || event["arm"] === "off");
    if (event["arm"] === "active") assert.equal(outcome.status, "passed");
    assert.deepEqual(
      [...new Set(seen)].filter((command) => command !== "git"),
      ["node --test"],
    );
  });

  it("the arm without the requirement records its assignment and runs nothing", () => {
    const repo = project("experiments:\n  red-green: random\n", "t3");
    repo.write("test/add.test.mjs", `${ADD_TEST}test("x", () => assert.ok(true));\n`);
    repo.write("src/math.mjs", "export const add = (a, b) => a + b;\n");
    const seen: string[] = [];
    assert.equal(check(repo, seen).notes[0]?.key, "gate.red_green.off");
    assert.ok(repo.read(join(".finitemonkey", "log.jsonl")).includes('"arm":"off"'));
    assert.ok(!seen.includes("node --test"));
  });
});
