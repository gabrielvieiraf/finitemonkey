import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { rulesSection } from "../src/bridge/instructions.js";
import type { TaskOutcome } from "../src/evolve/outcome.js";
import { parentFor, variantId } from "../src/evolve/propose.js";
import { runEvolve } from "../src/evolve/run.js";
import { significance, welchInterval } from "../src/evolve/significance.js";
import { scriptsDigest } from "../src/gate/scripts-digest.js";
import { type ArmRecord, excludedReminders, readEvolve, type Variant, variantArm } from "../src/policy/evolved.js";
import { loadPolicy } from "../src/policy/policy.js";
import { fmPaths } from "../src/task/paths.js";
import { policyWith } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { signedLine } from "./signed.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const RULES = [
  "rules:",
  "  - id: short",
  '    text: "Keep answers short and concrete"',
  "    severity: prefer",
  "    bucket: reminder",
  "    scope: {}",
  "",
].join("\n");

const CHANGE = { kind: "reminder", rule: "short", include: false } as const;
const ID = variantId(CHANGE);

const contract = (id: string): string =>
  `id: ${id}\ngoal: ${id}\nsize: S\nscope:\n  paths: [src/]\nacceptance:\n  - id: t\n    check: command\n    run: npm test\n`;

const gate = (task: string, status: string, at: number, scripts: string): string =>
  signedLine(repoRuntime(), {
    schema: "finitemonkey/evidence@1",
    task,
    check: "*gate*",
    kind: "gate",
    status,
    treeHash: "t",
    at: new Date(at).toISOString(),
    notes: [],
    scripts,
  });

const finished = (task: string, day: number, hours: number, scripts: string): string => {
  const start = Date.UTC(2026, 9, day, 9);
  return `${gate(task, "failed", start, scripts)}\n${gate(task, "passed", start + hours * 3_600_000, scripts)}\n`;
};

const injected = (count: number): string =>
  Array.from({ length: count }, (_, index) =>
    JSON.stringify({
      at: `2026-10-0${String((index % 9) + 1)}T10:00:00.000Z`,
      event: "reminder_shadow",
      rules: "short",
    }),
  ).join("\n");

const setup = (files: Readonly<Record<string, string>>, done: readonly string[], active = "now"): Repo => {
  const repo = makeRepo({
    ".finitemonkey/tasks/now.yml": contract("now"),
    ".finitemonkey/state.json": JSON.stringify({ schemaVersion: 1, active, done }),
    ".finitemonkey/policy.yml": `${policyWith({ evolve: "active", reminders: "active" })}evolve:\n  minTasks: 3\n`,
    ".finitemonkey/rules.yml": RULES,
    ...files,
  });
  repos.push(repo);
  return repo;
};

const tasksOn = (arm: "active" | "off", count: number, skip: readonly string[] = []): readonly string[] => {
  const found: string[] = [];
  for (let index = 0; found.length < count; index += 1) {
    const name = `t${String(index)}`;
    if (!skip.includes(name) && variantArm(name, ID) === arm) found.push(name);
  }
  return found;
};

const trial = (evaluator: string, tasks: Variant["tasks"], born: string | null): Variant => ({
  id: ID,
  change: CHANGE,
  reason: "injected 12 times, never violated",
  bornTask: born,
  bornAt: "2026-10-01T00:00:00.000Z",
  evaluator,
  status: "trial",
  tasks,
});

const outcome = (task: string, hours: number): TaskOutcome => ({
  task,
  falseDone: false,
  dismissals: 0,
  wallMs: hours * 3_600_000,
  evaluators: [],
  startMs: 0,
  endMs: 0,
});

describe("evolve: reminder sets, descendants and a significance test", () => {
  it("proposes withholding a reminder injected often and never violated, born on the active task", () => {
    const repo = setup({ ".finitemonkey/log.jsonl": `${injected(12)}\n` }, []);
    const result = runEvolve(repoRuntime(), fmPaths(repo.root), true);
    assert.deepEqual(result.proposed, [ID]);
    const stored = readEvolve(repoRuntime(), repo.root).variants[0];
    assert.equal(stored?.bornTask, "now");
    assert.deepEqual(stored.change, CHANGE);
    assert.equal(stored.tasks["now"]?.arm, undefined);
    assert.equal(excludedReminders(loadPolicy(repoRuntime(), repo.root)).size, 0);
  });

  it("never promotes the reminder variant on the task where it was born, however good that task looks", () => {
    const repo = setup({}, ["now"]);
    const digest = scriptsDigest(repoRuntime(), repo.root);
    repo.write(".finitemonkey/evidence/now.jsonl", finished("now", 1, 1, digest));
    repo.write(".finitemonkey/cache/evolve.json", JSON.stringify({ variants: [trial(digest, {}, "now")], unseen: [] }));
    const result = runEvolve(repoRuntime(), fmPaths(repo.root), true);
    assert.deepEqual(result.promoted, []);
    assert.equal(readEvolve(repoRuntime(), repo.root).variants[0]?.tasks["now"]?.arm, "off");
    assert.deepEqual(result.waiting, [{ id: ID, variantTasks: 0, parentTasks: 0 }]);
  });

  it("does not promote a difference whose Welch interval includes zero, from a fixture ledger", () => {
    const mine = tasksOn("active", 3);
    const parents = tasksOn("off", 3);
    const repo = setup({}, [...mine, ...parents], "idle");
    const digest = scriptsDigest(repoRuntime(), repo.root);
    const hours = [1, 6, 2, 5, 3, 4];
    [...mine, ...parents].forEach((task, index) => {
      repo.write(`.finitemonkey/evidence/${task}.jsonl`, finished(task, index + 1, hours[index] ?? 1, digest));
    });
    const tasks: Record<string, ArmRecord> = {};
    for (const task of mine) tasks[task] = { arm: "active", mode: "active" };
    for (const task of parents) tasks[task] = { arm: "off", mode: "active" };
    repo.write(
      ".finitemonkey/cache/evolve.json",
      JSON.stringify({ variants: [trial(digest, tasks, null)], unseen: [] }),
    );
    const result = runEvolve(repoRuntime(), fmPaths(repo.root), false);
    assert.deepEqual(result.promoted, []);
    assert.deepEqual(result.rejected, [ID]);
    const test = readEvolve(repoRuntime(), repo.root).variants[0]?.evidence?.test;
    assert.ok(test !== undefined);
    assert.equal(test.passed, false);
    const wall = test.intervals["wallMs"];
    assert.ok(wall !== null && wall !== undefined && wall[0] < 0 && wall[1] > 0, JSON.stringify(wall));
  });

  it("the Welch interval excludes zero only when the difference is clear", () => {
    const fast = [outcome("a", 1), outcome("b", 1.2), outcome("c", 0.9)];
    const slow = [outcome("d", 5), outcome("e", 5.5), outcome("f", 4.8)];
    assert.equal(significance(fast, slow).passed, true);
    assert.equal(significance(fast, [outcome("g", 1.1), outcome("h", 0.8), outcome("i", 1.3)]).passed, false);
    assert.equal(welchInterval([1], [2, 3]), null);
  });

  it("picks the parent from the archive: the latest promoted descendant that beat its ancestor", () => {
    const summary = (falseDone: number) => ({ tasks: ["x"], falseDone, dismissals: 0, medianWallMs: 1 });
    const archived = (id: string, decidedAt: string, won: boolean): Variant => ({
      ...trial("e", {}, null),
      id,
      status: "promoted",
      decidedAt,
      evidence: { variant: summary(won ? 0 : 1), parent: summary(won ? 1 : 0), evaluator: "e" },
    });
    const archive = [
      archived("v-old", "2026-10-01T00:00:00.000Z", true),
      archived("v-new", "2026-10-05T00:00:00.000Z", true),
      archived("v-lost", "2026-10-09T00:00:00.000Z", false),
    ];
    assert.equal(parentFor(archive, "reminder:short"), "v-new");
    assert.equal(parentFor(archive, "guard:prose"), undefined);
  });

  it("a promoted reminder variant takes the rule out of the injected set", () => {
    const repo = setup({}, []);
    assert.match(rulesSection(repoRuntime(), fmPaths(repo.root)), /Keep answers short and concrete/);
    const promoted: Variant = { ...trial("e", {}, null), status: "promoted" };
    repo.write(".finitemonkey/cache/evolve.json", JSON.stringify({ variants: [promoted], unseen: [] }));
    assert.deepEqual([...excludedReminders(loadPolicy(repoRuntime(), repo.root))], ["short"]);
    assert.equal(rulesSection(repoRuntime(), fmPaths(repo.root)), "");
  });
});
