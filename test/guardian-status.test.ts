import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import type { TextSource } from "../src/core/context.js";
import { parseGoals, renderGoals } from "../src/guardian/goals.js";
import { guardianStatus } from "../src/guardian/status.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { signedLine } from "./signed.js";
import { cli, cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });
const runtime = () => repoRuntime({ now: () => "2026-10-28T12:00:00.000Z" });

const contract = (id: string, extra: readonly string[] = [], paths = ["src/api/"], size = "S"): string =>
  [
    `id: ${id}`,
    `goal: work on ${id}`,
    `size: ${size}`,
    "scope:",
    `  paths: [${paths.join(", ")}]`,
    "acceptance:",
    "  - id: tests",
    "    check: command",
    "    run: npm test",
    ...extra,
    "",
  ].join("\n");

const GOALS = [
  "schema: finitemonkey/goals@1",
  "goals:",
  "  - id: g1",
  "    text: Sell plans to clubs",
  "    origin: stated",
  "  - id: g2",
  "    text: A mobile app",
  "    origin: inferred",
  "",
].join("\n");

const repoWith = (files: Readonly<Record<string, string>>): Repo => {
  const repo = makeRepo({ ".finitemonkey/goals.yml": GOALS, ...files });
  repos.push(repo);
  return repo;
};

const kindsFor = (repo: Repo): readonly (readonly [string, string])[] =>
  guardianStatus(runtime(), fmPaths(repo.root)).signals.map((item) => [item.kind, item.subject] as const);

const gate = (status: string, at: string, tree: string): string =>
  signedLine(repoRuntime(), {
    schema: "finitemonkey/evidence@1",
    task: "slow",
    check: "*gate*",
    kind: "gate",
    status,
    treeHash: tree,
    at,
    notes: [],
  });

const check = (name: string, status: string, at: string, tree: string): string =>
  signedLine(repoRuntime(), {
    schema: "finitemonkey/evidence@1",
    task: "slow",
    check: name,
    kind: "command",
    status,
    treeHash: tree,
    at,
    notes: [],
  });

describe("guardian status", () => {
  it("keeps unknown keys and both origins when the file is rewritten", () => {
    const goals = parseGoals(`${GOALS}context:\n  stage: mvp\n`);
    assert.deepEqual(
      goals.entries.map((entry) => [entry.id, entry.origin]),
      [
        ["g1", "stated"],
        ["g2", "inferred"],
      ],
    );
    assert.match(renderGoals(goals), /context:\n {2}stage: mvp/);
  });

  it("never uses an inferred goal as approved: a task linked only to it is reported", () => {
    const repo = repoWith({
      ".finitemonkey/tasks/app.yml": contract("app", ["goals: [g2]"]),
      ".finitemonkey/tasks/plans.yml": contract("plans", ["goals: [g1]"]),
    });
    assert.deepEqual(kindsFor(repo), [["unlinked_task", "app"]]);
  });

  it("reports scope that grew after approval and stays quiet when it did not", () => {
    const approved = contract("grow", ["goals: [g1]"]);
    const repo = repoWith({
      ".finitemonkey/tasks/grow.yml": contract("grow", ["goals: [g1]"], ["src/api/", "src/billing/"], "M"),
      ".finitemonkey/tasks/same.yml": contract("same", ["goals: [g1]"]),
      ".finitemonkey/trust.json": JSON.stringify({
        contracts: {},
        approved: { grow: approved, same: contract("same", ["goals: [g1]"]) },
      }),
    });
    const signals = guardianStatus(runtime(), fmPaths(repo.root)).signals;
    assert.deepEqual(
      signals.map((item) => [item.kind, item.subject, item.detail]),
      [["scope_growth", "grow", "+src/billing/; size S -> M"]],
    );
  });

  it("reports a decision reopened without a new FACT line, and not one that brings new evidence", () => {
    const fact = (text: string): string =>
      `# Decision\n\n## Proof\n\nFACT: ${text} (https://example.com, 2026-10-01)\n`;
    const repo = repoWith({
      "docs/plan/01-decision-queue.md": fact("the queue drops jobs"),
      "docs/plan/03-decision-queue.md": fact("the queue drops jobs"),
      "docs/plan/02-decision-cache.md": fact("hits are 40%"),
      "docs/plan/04-decision-cache.md": `${fact("hits are 40%")}\nFACT: misses cost 300 ms (src/cache.ts:12, 2026-10-20)\n`,
    });
    assert.deepEqual(kindsFor(repo), [["reopened_decision", "docs/plan/03-decision-queue.md"]]);
  });

  it("reports a task one check short of passing on three different days", () => {
    const ledger = (days: readonly string[]): string =>
      `${days
        .flatMap((day) => [
          check("tests", "passed", `${day}T10:00:00.000Z`, day),
          check("lint", "failed", `${day}T10:00:01.000Z`, day),
          gate("failed", `${day}T10:00:02.000Z`, day),
        ])
        .join("\n")}\n`;
    const stalled = repoWith({
      ".finitemonkey/tasks/slow.yml": contract("slow", ["goals: [g1]"]),
      ".finitemonkey/evidence/slow.jsonl": ledger(["2026-10-20", "2026-10-22", "2026-10-25"]),
    });
    assert.deepEqual(kindsFor(stalled), [["stalled", "slow"]]);
    const recent = repoWith({
      ".finitemonkey/tasks/slow.yml": contract("slow", ["goals: [g1]"]),
      ".finitemonkey/evidence/slow.jsonl": ledger(["2026-10-24", "2026-10-25"]),
    });
    assert.deepEqual(kindsFor(recent), []);
  });

  it("status --json carries the frozen schema", async () => {
    const repo = repoWith({ ".finitemonkey/tasks/plans.yml": contract("plans", ["goals: [g1]"]) });
    const run = await cliJson(["guardian", "status"], { cwd: repo.root, runtime: runtime() });
    assert.equal(run.code, 0);
    assert.equal(field(run.body, "data", "schema"), "finitemonkey/guardian-status@1");
    assert.deepEqual(field(run.body, "data", "goals"), { stated: 1, inferred: 1 });
  });

  it("an agent adds goals as inferred and cannot confirm them; the person in a terminal can", async () => {
    const repo = repoWith({});
    const agent = { CLAUDECODE: "1" };
    const added = await cliJson(["guardian", "goal", "add", "Ship billing"], {
      cwd: repo.root,
      env: agent,
      runtime: runtime(),
    });
    assert.equal(field(added.body, "data", "entry", "origin"), "inferred");
    const id = String(field(added.body, "data", "entry", "id"));
    const refused = await cli(["guardian", "goal", "confirm", id], {
      cwd: repo.root,
      env: agent,
      stdin: tty(),
      runtime: runtime(),
    });
    assert.notEqual(refused.code, 0);
    const confirmed = await cli(["guardian", "goal", "confirm", id], {
      cwd: repo.root,
      stdin: tty(),
      runtime: runtime(),
    });
    assert.equal(confirmed.code, 0);
    assert.match(
      repo.read(".finitemonkey/goals.yml"),
      new RegExp(`id: ${id}\\n {4}text: Ship billing\\n {4}origin: stated`),
    );
  });
});
