import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { guardianStatus } from "../src/guardian/status.js";
import { fmPaths } from "../src/task/paths.js";
import { contextOf, fireHook, policyWith } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { signedLine } from "./signed.js";
import { cli } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const contract = (id: string, paths = "[src/billing/]", size = "M"): string =>
  `id: ${id}\ngoal: ${id}\nsize: ${size}\nscope:\n  paths: ${paths}\nacceptance:\n  - id: t\n    check: command\n    run: npm test\n`;

const evidence = (task: string, check: string, status: string, at: string, tree = "t"): string =>
  signedLine(repoRuntime(), {
    schema: "finitemonkey/evidence@1",
    task,
    check,
    kind: check === "*gate*" ? "gate" : "command",
    status,
    treeHash: tree,
    at,
    notes: [],
  });

const finished = (id: string, day: number, hours: number): Readonly<Record<string, string>> => {
  const start = Date.UTC(2026, 9, day, 9);
  return {
    [`.finitemonkey/tasks/${id}.yml`]: contract(id),
    [`.finitemonkey/evidence/${id}.jsonl`]: `${[
      evidence(id, "tests", "failed", new Date(start).toISOString()),
      evidence(id, "*gate*", "failed", new Date(start + 60_000).toISOString()),
      evidence(id, "*gate*", "passed", new Date(start + hours * 3_600_000).toISOString()),
    ].join("\n")}\n`,
  };
};

const history = (count: number): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Array.from({ length: count }, (_, index) =>
      Object.entries(finished(`past${String(index + 1)}`, index + 1, index + 1)),
    ).flat(),
  );

const setup = (count: number, extra: Readonly<Record<string, string>> = {}): Repo => {
  const done = Array.from({ length: count }, (_, index) => `past${String(index + 1)}`);
  const repo = makeRepo({
    ...history(count),
    ".finitemonkey/tasks/new.yml": contract("new"),
    ".finitemonkey/state.json": JSON.stringify({ schemaVersion: 1, active: "new", done }),
    ".finitemonkey/policy.yml": policyWith({ forecast: "active" }),
    ...extra,
  });
  repos.push(repo);
  return repo;
};

describe("forecasts from the person's own history", () => {
  it("shows no forecast below five comparable tasks", async () => {
    const repo = setup(4);
    const run = await cli(["guardian", "forecast", "new"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(run.stdout, /Fewer than five/);
  });

  it("cites the tasks it used and their median, when the person trusts the contract", async () => {
    const repo = setup(5, { ".finitemonkey/tasks/other.yml": contract("other", "[src/auth/]") });
    const run = await cli(["guardian", "forecast", "new"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(
      run.stdout,
      /last 5 tasks of size M in src\/billing took 3\.0 h \(median\) and 2 gate runs \(median\): past1, past2, past3, past4, past5/,
    );
    const shown = await fireHook(repo, "UserPromptSubmit", { prompt: "finitemonkey: trust new" });
    assert.match(contextOf(shown), /past1, past2, past3, past4, past5/);
  });

  it("marks a task past twice its reference median and one check short as escalation", () => {
    const repo = setup(5, {
      ".finitemonkey/evidence/new.jsonl": `${[
        evidence("new", "tests", "passed", "2026-10-20T09:00:00.000Z", "a"),
        evidence("new", "lint", "failed", "2026-10-20T09:00:01.000Z", "a"),
        evidence("new", "*gate*", "failed", "2026-10-20T09:00:02.000Z", "a"),
      ].join("\n")}\n`,
    });
    const now = repoRuntime({ now: () => "2026-10-20T16:00:00.000Z" });
    const signals = guardianStatus(now, fmPaths(repo.root)).signals.filter((item) => item.kind === "escalation");
    assert.deepEqual(
      signals.map((item) => [item.subject, item.detail]),
      [["new", "7.0"]],
    );
    const early = repoRuntime({ now: () => "2026-10-20T13:00:00.000Z" });
    assert.equal(
      guardianStatus(early, fmPaths(repo.root)).signals.some((item) => item.kind === "escalation"),
      false,
    );
  });
});
