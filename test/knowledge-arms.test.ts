import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { appendEvidence } from "../src/evidence/ledger.js";
import type { Evidence } from "../src/evidence/types.js";
import { armOf } from "../src/policy/experiment.js";
import { fmPaths } from "../src/task/paths.js";
import { contextOf, fireHook } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const gate = (task: string, status: "passed" | "failed", minute: number): Evidence => ({
  schema: "finitemonkey/evidence@1",
  task,
  check: "*gate*",
  kind: "gate",
  status,
  treeHash: "wabc",
  at: new Date(Date.UTC(2026, 9, 1, 10, minute)).toISOString(),
  notes: [],
});

const arm = (feature: string, task: string): string =>
  JSON.stringify({ at: "2026-10-01T09:00:00.000Z", event: "experiment_arm", feature, task, arm: armOf(task, feature) });

const policy = (source: string): string =>
  [
    "guards:",
    "  knowledge-claims: active",
    "experiments:",
    `  ${source}: random`,
    "knowledge:",
    "  demoteAfter: 10",
    "",
  ].join("\n");

const fixture = (source: string, helps: boolean): Repo => {
  const tasks = Array.from({ length: 40 }, (_, index) => `t${String(index + 1)}`);
  const repo = makeRepo({
    "src/a.ts": "export function a(): number {\n  return 1;\n}\n",
    ".finitemonkey/policy.yml": policy(source),
    ".finitemonkey/log.jsonl": `${tasks.map((task) => arm(source, task)).join("\n")}\n`,
  });
  repos.push(repo);
  const runtime = repoRuntime();
  const paths = fmPaths(repo.root);
  for (const task of tasks) {
    const quick = !helps || armOf(task, source) === "active";
    const runs = quick
      ? [gate(task, "passed", 1)]
      : [gate(task, "failed", 1), gate(task, "failed", 2), gate(task, "passed", 3)];
    appendEvidence(runtime, paths.evidence(task), runs);
  }
  return repo;
};

const report = async (repo: Repo) => {
  const run = await cliJson(["experiments", "report"], { cwd: repo.root, runtime: repoRuntime() });
  assert.equal(run.code, 0, run.stdout);
  const sources = field(run.body, "data", "sources");
  const first: unknown = Array.isArray(sources) ? sources[0] : undefined;
  return { body: run.body, first };
};

describe("knowledge sources as A/B arms", () => {
  it("reports effect, interval and cost per source, and demotes the one with no detectable effect", async () => {
    const flat = await report(fixture("knowledge-claims", false));
    assert.equal(field(flat.first, "effect"), 0);
    assert.deepEqual(field(flat.first, "interval"), [0, 0]);
    assert.equal(field(flat.first, "demoted"), true);
    assert.deepEqual(field(flat.body, "data", "demoted"), ["knowledge-claims"]);
    const useful = await report(fixture("learnings", true));
    assert.equal(field(useful.first, "effect"), -2);
    assert.equal(field(useful.first, "demoted"), false);
    assert.deepEqual(field(useful.body, "data", "demoted"), []);
  });

  it("drops a source for a task in the off arm and logs the drop", async () => {
    const off = Array.from({ length: 50 }, (_, index) => `task${String(index)}`).find(
      (task) => armOf(task, "knowledge-claims") === "off",
    );
    assert.ok(off !== undefined);
    const repo = makeRepo({
      "src/a.ts": "export function a(): number {\n  return 1;\n}\n",
      ".finitemonkey/policy.yml": "guards:\n  knowledge-claims: active\nexperiments:\n  knowledge-claims: random\n",
      ".finitemonkey/state.json": JSON.stringify({ schemaVersion: 1, active: off, done: [] }),
    });
    repos.push(repo);
    const added = await cliJson(["claims", "add", "a returns one", "--anchor", "src/a.ts#a", "--origin", "person"], {
      cwd: repo.root,
      runtime: repoRuntime(),
    });
    assert.equal(added.code, 0, added.stdout);
    const started = await fireHook(repo, "SessionStart", { source: "startup" });
    assert.equal(contextOf(started), "");
    assert.match(
      repo.read(".finitemonkey/log.jsonl"),
      new RegExp(`"event":"experiment_drop","feature":"knowledge-claims","task":"${off}"`),
    );
  });
});
