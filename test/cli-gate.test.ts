import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { isRecord } from "../src/core/parsed.js";
import { readLedger } from "../src/evidence/ledger.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, NO_PR, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, field, parseBody, ROOT } from "./support.js";

const frozen = parseBody(readFileSync(join(ROOT, "test", "fixtures", "contract-v1.json"), "utf8"));
const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const repo = (): Repo => {
  const made = makeRepo({ "src/a.js": "export const a = 1;\n", "test/a.test.js": PASSING_TEST });
  repos.push(made);
  return made;
};

const keysOf = (name: string, part: "required" | "optional"): readonly string[] => {
  const value = field(frozen, name, part);
  return isRecord(value) ? Object.keys(value) : [];
};

const hasShape = (value: unknown, name: string): void => {
  assert.ok(isRecord(value), name);
  for (const key of keysOf(name, "required")) assert.ok(key in value, `${name}.${key}`);
};

describe("finitemonkey task and gate", () => {
  it("task new writes the contract and returns the skill-facing JSON", async () => {
    const target = repo();
    const { code, body } = await cliJson(
      [
        "task",
        "new",
        "coupon",
        "--goal",
        "Fix the coupon",
        "--tests",
        "node --test",
        "--paths",
        "src/**,test/**",
        "--manual",
        "Ana approves",
      ],
      {
        cwd: target.root,
        runtime: repoRuntime(),
      },
    );
    assert.equal(code, 0);
    assert.equal(body["command"], "task new");
    hasShape(body["data"], "taskNew");
    assert.equal(field(body, "data", "schema"), field(frozen, "taskNew", "schema"));
    assert.equal(body["next"], "finitemonkey gate");
    assert.match(target.read(".finitemonkey/tasks/coupon.yml"), /^id: coupon\ngoal: Fix the coupon\n/);
  });

  it("task new refuses an existing id and an empty folder that is not a repo", async () => {
    const target = repo();
    const argv = ["task", "new", "x", "--goal", "g"];
    assert.equal((await cliJson(argv, { cwd: target.root, runtime: repoRuntime() })).code, 0);
    const again = await cliJson(argv, { cwd: target.root, runtime: repoRuntime() });
    assert.equal(again.code, 2);
    assert.equal(field(again.body, "error", "code"), "task_exists");
  });

  it("gate --json reports from evidence and keeps the frozen shape", async () => {
    const target = repo();
    await cli(["task", "new", "t", "--goal", "g", "--tests", "node --test"], {
      cwd: target.root,
      runtime: repoRuntime(),
    });
    target.write("src/a.js", "export const a = 2; // TODO\n");
    const { code, body } = await cliJson(["gate"], { cwd: target.root, runtime: repoRuntime({ gh: NO_PR }) });
    assert.equal(code, 1);
    assert.equal(field(body, "error", "code"), "gate_failed");
    const data = body["data"];
    hasShape(data, "gate");
    assert.equal(field(data, "schema"), field(frozen, "gate", "schema"));
    assert.equal(field(data, "state"), "failed");
    assert.match(String(field(data, "stateReason")), /^failed:/);
    const items = field(data, "items");
    assert.ok(Array.isArray(items));
    for (const item of items) hasShape(item, "gateItem");
    for (const entry of readLedger(repoRuntime(), fmPaths(target.root).evidence("t"))) hasShape(entry, "evidence");
  });

  it("gate prints passed, failed and not verified for people", async () => {
    const target = repo();
    await cli(["task", "new", "t", "--goal", "g", "--run", "definitely-not-a-real-tool-fm", "--tests", "node --test"], {
      cwd: target.root,
      runtime: repoRuntime(),
    });
    target.write("src/a.js", "export const a = 2; // TODO\n");
    const { stdout } = await cli(["gate"], { cwd: target.root, runtime: repoRuntime({ gh: NO_PR }) });
    assert.match(stdout, /not verified +C1 +command `definitely-not-a-real-tool-fm`/);
    assert.match(stdout, /passed +tests +tests `node --test`/);
    assert.match(stdout, /failed +placeholders/);
    assert.match(stdout, /Not done\./);
  });

  it("task done closes the task only when everything passed", async () => {
    const target = repo();
    await cli(["task", "new", "t", "--goal", "g", "--tests", "node --test"], {
      cwd: target.root,
      runtime: repoRuntime(),
    });
    target.write("src/a.js", "export const a = 2;\n");
    const done = await cliJson(["task", "done"], { cwd: target.root, runtime: repoRuntime({ gh: NO_PR }) });
    assert.equal(done.code, 0, JSON.stringify(done.body));
    const show = await cliJson(["task", "show", "t"], { cwd: target.root, runtime: repoRuntime() });
    assert.equal(field(show.body, "data", "active"), null);
    assert.equal(field(show.body, "data", "report", "task"), "t");
  });

  it("task done with something unverified keeps the task open", async () => {
    const target = repo();
    await cli(["task", "new", "t", "--goal", "g", "--tests", "node --test"], {
      cwd: target.root,
      runtime: repoRuntime(),
    });
    target.write("src/a.js", "export const a = 2;\n");
    const done = await cliJson(["task", "done"], { cwd: target.root, runtime: repoRuntime() });
    assert.equal(done.code, 1);
    assert.equal(field(done.body, "error", "code"), "gate_incomplete");
  });
});
