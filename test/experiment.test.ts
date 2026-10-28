import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { gainReport } from "../src/gain/gain.js";
import { armOf, experimentArm, recordArms } from "../src/policy/experiment.js";
import { featureMode } from "../src/policy/feature.js";
import { modeOf } from "../src/policy/guards.js";
import { DEFAULT_POLICY, parsePolicy, STARTS_IN_SHADOW } from "../src/policy/policy.js";
import { fmPaths } from "../src/task/paths.js";
import { memoryFs } from "./memory-fs.js";
import { cliJson, fakeRuntime, field } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const at = (relative: string): string => toAbsolutePath(join(ROOT, relative));
const NOW = "2026-10-28T12:00:00.000Z";
const POLICY = "guards:\n  quality: active\nexperiments:\n  reminders: random\n  slop: random\n  quality: random\n";

const project = (files: Readonly<Record<string, string>> = {}) =>
  memoryFs({ [at(".finitemonkey/policy.yml")]: POLICY, ...files }, [at(".git")], NOW);

describe("experiments: per-feature arms", () => {
  it("reads random arms from policy.yml and ignores other values", () => {
    const policy = parsePolicy(`${POLICY}  advisor: maybe\n`);
    assert.deepEqual(policy.experiments, { reminders: "random", slop: "random", quality: "random" });
    assert.deepEqual(DEFAULT_POLICY.experiments, {});
  });

  it("assigns the same arm to the same task and splits tasks between both arms", () => {
    assert.equal(armOf("checkout", "reminders"), armOf("checkout", "reminders"));
    const arms = Array.from({ length: 200 }, (_, index) => armOf(`task-${String(index)}`, "reminders"));
    const active = arms.filter((arm) => arm === "active").length;
    assert.ok(active > 70 && active < 130, String(active));
  });

  it("an experiment overrides the guard mode for the active task, and only with an active task", () => {
    const fs = project({ [at(".finitemonkey/state.json")]: '{"active":"checkout"}\n' });
    const runtime = fakeRuntime({ fs });
    const paths = fmPaths(ROOT);
    const policy = parsePolicy(POLICY);
    const arm = experimentArm(runtime, paths, policy, "quality");
    assert.equal(arm, armOf("checkout", "quality"));
    assert.equal(modeOf({ id: "quality", damage: false }, policy, {}, arm), arm);
    assert.equal(featureMode(runtime, paths, "reminders"), armOf("checkout", "reminders"));
    assert.equal(experimentArm(fakeRuntime({ fs: project() }), paths, policy, "quality"), undefined);
    assert.equal(modeOf({ id: "secrets", damage: true }, policy, {}, "off"), "active");
  });

  it("new features that block or inject start in shadow without a policy file", () => {
    for (const id of [
      "quality",
      "slop",
      "tests-hold",
      "regression",
      "advisor",
      "reminders",
      "learnings",
      "rules-stop",
    ]) {
      assert.ok(STARTS_IN_SHADOW.has(id), id);
      assert.equal(modeOf({ id, damage: false }, DEFAULT_POLICY, {}), "shadow", id);
    }
  });

  it("records each experiment's arm once when a task is created", () => {
    const fs = project();
    const runtime = fakeRuntime({ fs });
    recordArms(runtime, fmPaths(ROOT), parsePolicy(POLICY), "checkout");
    const lines = (fs.read(at(".finitemonkey/log.jsonl")) ?? "").trim().split("\n");
    assert.equal(lines.length, 3);
    assert.match(
      lines[0] ?? "",
      /"event":"experiment_arm","feature":"reminders","task":"checkout","arm":"(active|off)"/,
    );
  });
});

describe("finitemonkey gain --by-arm", () => {
  const gate = (task: string, status: "passed" | "failed", durationMs: number): string =>
    JSON.stringify({
      schema: "finitemonkey/evidence@1",
      task,
      check: "*gate*",
      kind: "gate",
      status,
      treeHash: "abc",
      at: NOW,
      notes: [],
      durationMs,
    });

  const fixture = () => {
    const arms = [
      { feature: "slop", task: "a", arm: "active" },
      { feature: "slop", task: "b", arm: "active" },
      { feature: "slop", task: "c", arm: "off" },
    ]
      .map((line) => JSON.stringify({ at: NOW, event: "experiment_arm", ...line }))
      .join("\n");
    return project({
      [at(".finitemonkey/log.jsonl")]: `${arms}\n`,
      [at(".finitemonkey/evidence/a.jsonl")]: `${gate("a", "failed", 1000)}\n${gate("a", "passed", 3000)}\n`,
      [at(".finitemonkey/evidence/b.jsonl")]: `${gate("b", "failed", 2000)}\n`,
      [at(".finitemonkey/evidence/c.jsonl")]: `${gate("c", "passed", 4000)}\n`,
    });
  };

  it("compares the arms of each feature by assignment, counting tasks that never passed", () => {
    const report = gainReport(fakeRuntime({ fs: fixture() }), fmPaths(ROOT), 7, undefined, true);
    assert.deepEqual(report.byArm, {
      slop: {
        active: { tasks: 2, completed: 1, gateRuns: 3, gateFailed: 2, gateMedianMs: 2000 },
        off: { tasks: 1, completed: 1, gateRuns: 1, gateFailed: 0, gateMedianMs: 4000 },
      },
    });
  });

  it("is absent without the flag and listed in the command output with it", async () => {
    assert.equal(gainReport(fakeRuntime({ fs: fixture() }), fmPaths(ROOT), 7).byArm, undefined);
    const result = await cliJson(["gain", "--by-arm"], { cwd: ROOT, runtime: fakeRuntime({ fs: fixture() }) });
    assert.equal(result.code, 0, result.stdout);
    assert.deepEqual(field(result.body, "data", "byArm", "slop", "off", "tasks"), 1);
  });
});
