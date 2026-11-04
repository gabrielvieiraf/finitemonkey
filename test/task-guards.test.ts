import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { resolveGuard } from "../src/policy/guards.js";
import { DEFAULT_POLICY, type Policy } from "../src/policy/policy.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { validateContract } from "../src/task/validate.js";
import { makeRepo, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";

const contract = (guards: Readonly<Record<string, string>>) => ({
  id: "t1",
  goal: "g",
  acceptance: [{ id: "tests", check: "tests", run: "node --test" }],
  guards,
});

const withTask = (modes: Policy["guards"], approved: boolean, guards: Policy["guards"] = {}): Policy => ({
  ...DEFAULT_POLICY,
  guards,
  task: { task: "t1", approved: approved ? modes : {}, pending: modes },
});

const guard = (id: string, damage = false) => ({ id, damage });

describe("task-level guard modes", () => {
  it("a contract can carry guard modes, and weakening a damage guard is an error", () => {
    const valid = validateContract(contract({ scope: "active", deps: "shadow" }));
    assert.ok(valid.ok);
    assert.deepEqual(valid.value.guards, { scope: "active", deps: "shadow" });
    const weakened = validateContract(contract({ secrets: "shadow" }));
    assert.ok(!weakened.ok);
    assert.deepEqual(weakened.error, ["guards.secrets: a damage guard cannot be weakened by a task"]);
    const unknown = validateContract(contract({ nope: "active", scope: "loud" }));
    assert.ok(!unknown.ok);
    assert.deepEqual(unknown.error, ["guards.nope: unknown guard", "guards.scope: use off, shadow, active"]);
  });

  it("a task entry tightens a guard, even before the contract is approved", () => {
    const resolved = resolveGuard(guard("scope"), withTask({ scope: "active" }, false), {});
    assert.deepEqual(resolved, { mode: "active", source: "task", ignored: [] });
  });

  it("a task entry never weakens a guard the project set explicitly", () => {
    const resolved = resolveGuard(guard("deps"), withTask({ deps: "off" }, true, { deps: "active" }), {});
    assert.deepEqual(resolved, { mode: "active", source: "project", ignored: [{ source: "task", mode: "off" }] });
  });

  it("a task entry never weakens a damage guard", () => {
    const resolved = resolveGuard(guard("secrets", true), withTask({ secrets: "off" }, true), {});
    assert.equal(resolved.mode, "active");
    assert.deepEqual(resolved.ignored, [{ source: "task", mode: "off" }]);
  });

  it("an approved contract may relax a default guard, an unapproved one may not", () => {
    assert.equal(resolveGuard(guard("deps"), withTask({ deps: "shadow" }, true), {}).source, "task");
    assert.equal(resolveGuard(guard("deps"), withTask({ deps: "shadow" }, true), {}).mode, "shadow");
    assert.equal(resolveGuard(guard("deps"), withTask({ deps: "shadow" }, false), {}).mode, "active");
  });
});

describe("policy explain shows the task source", () => {
  const repos: Repo[] = [];
  after(() => {
    for (const repo of repos) repo.cleanup();
  });

  it("names the active task contract as the source of a tightened guard", async () => {
    const repo = makeRepo({ "src/a.js": "export const a = 1;\n", "test/a.test.js": PASSING_TEST });
    repos.push(repo);
    const paths = fmPaths(repo.root);
    const created = createTask(repoRuntime(), paths, {
      id: "t1",
      goal: "change a",
      size: "S",
      base: undefined,
      paths: [],
      runs: [],
      tests: "node --test",
      git: [],
      manual: [],
      budget: undefined,
    });
    assert.ok(created.ok);
    repo.write(".fm/tasks/t1.yml", `${created.value.text}guards:\n  scope: active\n`);
    const { body } = await cliJson(["policy", "explain"], { cwd: repo.root, runtime: repoRuntime() });
    const rows = field(body, "data", "guards");
    assert.ok(Array.isArray(rows));
    const scope: unknown = rows.find((row: unknown) => field(row, "guard") === "scope");
    assert.equal(field(scope, "mode"), "active");
    assert.equal(field(scope, "source"), "task");
  });
});
