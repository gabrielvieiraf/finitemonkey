import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { variantId } from "../src/evolve/propose.js";
import { runEvolve } from "../src/evolve/run.js";
import { scriptsDigest } from "../src/gate/scripts-digest.js";
import { readEvolve, type Variant, variantArm } from "../src/policy/evolved.js";
import { loadPolicy } from "../src/policy/policy.js";
import { fmPaths } from "../src/task/paths.js";
import { contextOf, fireHook, policyWith, tty } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { signedLine } from "./signed.js";
import { cli } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const contract = (id: string): string =>
  `id: ${id}\ngoal: ${id}\nsize: S\nscope:\n  paths: [src/]\nacceptance:\n  - id: t\n    check: command\n    run: npm test\n`;

const line = (task: string, check: string, status: string, at: number, scripts: string): string =>
  signedLine(repoRuntime(), {
    schema: "finitemonkey/evidence@1",
    task,
    check,
    kind: check === "*gate*" ? "gate" : "command",
    status,
    treeHash: "t",
    at: new Date(at).toISOString(),
    notes: [],
    ...(check === "*gate*" ? { scripts } : {}),
  });

const finished = (task: string, day: number, hours: number, scripts: string, falseDone = false): string => {
  const start = Date.UTC(2026, 9, day, 9);
  return `${[
    line(task, "t", "passed", start, scripts),
    line(task, "*gate*", "passed", start + hours * 3_600_000, scripts),
    ...(falseDone ? [line(task, "*gate*", "failed", start + (hours + 1) * 3_600_000, scripts)] : []),
  ].join("\n")}\n`;
};

const CHANGE = { kind: "guard", guard: "prose", mode: "shadow" } as const;
const ID = variantId(CHANGE);

const taskOn = (arm: "active" | "off", skip: readonly string[] = []): string => {
  for (let index = 0; index < 500; index += 1) {
    const name = `t${String(index)}`;
    if (!skip.includes(name) && variantArm(name, ID) === arm) return name;
  }
  throw new Error("no task for arm");
};

const variant = (evaluator: string, tasks: Variant["tasks"], born = "born"): Variant => ({
  id: ID,
  change: CHANGE,
  reason: "dismissed 5 of 10 firings",
  bornTask: born,
  bornAt: "2026-10-01T00:00:00.000Z",
  evaluator,
  status: "trial",
  tasks,
});

const setup = (files: Readonly<Record<string, string>>, done: readonly string[], active = "now"): Repo => {
  const repo = makeRepo({
    ".finitemonkey/tasks/now.yml": contract("now"),
    ".finitemonkey/state.json": JSON.stringify({ schemaVersion: 1, active, done }),
    ".finitemonkey/policy.yml": `${policyWith({ evolve: "active" })}evolve:\n  minTasks: 1\n`,
    ...files,
  });
  repos.push(repo);
  return repo;
};

const digestOf = (repo: Repo): string => scriptsDigest(repoRuntime(), repo.root);

const withVariant = (repo: Repo, value: Variant): void => {
  repo.write(".finitemonkey/cache/evolve.json", JSON.stringify({ variants: [value], unseen: [] }));
};

const run = (repo: Repo): ReturnType<typeof runEvolve> => runEvolve(repoRuntime(), fmPaths(repo.root), true);

describe("cumulative selection of policy variants", () => {
  it("never promotes a variant on the task where it was born", () => {
    const parent = taskOn("off");
    const repo = setup({}, ["born", parent]);
    const digest = digestOf(repo);
    repo.write(".finitemonkey/evidence/born.jsonl", finished("born", 1, 1, digest));
    repo.write(`.finitemonkey/evidence/${parent}.jsonl`, finished(parent, 2, 5, digest, true));
    withVariant(
      repo,
      variant(digest, { born: { arm: "active", mode: "active" }, [parent]: { arm: "off", mode: "active" } }),
    );
    const result = run(repo);
    assert.deepEqual(result.promoted, []);
    assert.deepEqual(result.waiting, [{ id: ID, variantTasks: 0, parentTasks: 1 }]);
  });

  it("promotes a variant that beats its parent on later tasks and shows it with a revert command", async () => {
    const mine = taskOn("active");
    const parent = taskOn("off");
    const repo = setup({}, [mine, parent], mine);
    const digest = digestOf(repo);
    repo.write(`.finitemonkey/evidence/${mine}.jsonl`, finished(mine, 1, 1, digest));
    repo.write(`.finitemonkey/evidence/${parent}.jsonl`, finished(parent, 2, 5, digest, true));
    withVariant(
      repo,
      variant(digest, { [mine]: { arm: "active", mode: "active" }, [parent]: { arm: "off", mode: "active" } }),
    );
    assert.deepEqual(run(repo).promoted, [ID]);
    assert.equal(loadPolicy(repoRuntime(), repo.root).evolved["prose"], "shadow");
    const shown = await fireHook(repo, "UserPromptSubmit", { prompt: "next" });
    assert.match(contextOf(shown), new RegExp(`Policy variant ${ID} promoted: guards\\.prose: shadow`));
    assert.equal(contextOf(await fireHook(repo, "UserPromptSubmit", { prompt: "again" })).includes(ID), false);
    const history = await cli(["policy", "history"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(history.stdout, new RegExp(`${ID} \\[promoted\\] guards\\.prose: shadow`));
    assert.match(history.stdout, /false done 0% vs 100%/);
    assert.match(history.stdout, new RegExp(`Revert: finitemonkey policy revert ${ID}`));
    const agent = await cli(["policy", "revert", ID], { cwd: repo.root, runtime: repoRuntime() });
    assert.notEqual(agent.code, 0);
    const person = await cli(["policy", "revert", ID], { cwd: repo.root, runtime: repoRuntime(), stdin: tty() });
    assert.equal(person.code, 0, person.stdout + person.stderr);
    assert.equal(readEvolve(repoRuntime(), repo.root).variants[0]?.status, "reverted");
    assert.equal(loadPolicy(repoRuntime(), repo.root).evolved["prose"], undefined);
  });

  it("stops every promotion when the evaluator hash changed", () => {
    const mine = taskOn("active");
    const parent = taskOn("off");
    const repo = setup({}, [mine, parent], mine);
    const digest = digestOf(repo);
    repo.write(`.finitemonkey/evidence/${mine}.jsonl`, finished(mine, 1, 1, digest));
    repo.write(`.finitemonkey/evidence/${parent}.jsonl`, finished(parent, 2, 5, digest, true));
    withVariant(
      repo,
      variant("0".repeat(32), { [mine]: { arm: "active", mode: "active" }, [parent]: { arm: "off", mode: "active" } }),
    );
    const result = run(repo);
    assert.deepEqual(result.promoted, []);
    assert.deepEqual(result.halted, [ID]);
    assert.equal(readEvolve(repoRuntime(), repo.root).variants[0]?.status, "trial");
  });

  it("does not count tasks that ran while evolve was in shadow", () => {
    const mine = taskOn("active");
    const parent = taskOn("off");
    const repo = setup({}, [mine, parent], mine);
    const digest = digestOf(repo);
    repo.write(`.finitemonkey/evidence/${mine}.jsonl`, finished(mine, 1, 1, digest));
    repo.write(`.finitemonkey/evidence/${parent}.jsonl`, finished(parent, 2, 5, digest, true));
    withVariant(
      repo,
      variant(digest, { [mine]: { arm: "active", mode: "shadow" }, [parent]: { arm: "off", mode: "shadow" } }),
    );
    assert.deepEqual(run(repo).promoted, []);
  });

  it("proposes a looser guard where dismissals are high, born on the active task, applied only to its arm", () => {
    const now = Date.parse("2026-10-20T00:00:00.000Z");
    const times = (count: number): number[] => Array.from({ length: count }, (_, index) => now - index * 60_000);
    const repo = setup(
      { ".finitemonkey/cache/alert-budget.json": JSON.stringify({ prose: { fired: times(10), dismissed: times(4) } }) },
      [],
    );
    const runtime = { ...repoRuntime(), now: () => "2026-10-20T00:00:00.000Z" };
    const result = runEvolve(runtime, fmPaths(repo.root), true);
    assert.deepEqual(result.proposed, [ID]);
    const stored = readEvolve(repoRuntime(), repo.root).variants[0];
    assert.equal(stored?.bornTask, "now");
    assert.deepEqual(stored.change, CHANGE);
    assert.equal(loadPolicy(repoRuntime(), repo.root).evolved["prose"], undefined);
    const other = taskOn("active", ["now"]);
    repo.write(".finitemonkey/state.json", JSON.stringify({ schemaVersion: 1, active: other, done: [] }));
    assert.equal(loadPolicy(repoRuntime(), repo.root).evolved["prose"], "shadow");
  });
});
