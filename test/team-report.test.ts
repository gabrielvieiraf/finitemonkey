import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, describe, it } from "node:test";

import { readCommits } from "../src/team/history.js";
import { teamReport, wilson } from "../src/team/report.js";
import { policyWith } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { signedLine } from "./signed.js";
import { cli } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const commitAs = (repo: Repo, email: string, date: string, subject: string, file: string): void => {
  repo.write(file, `${subject}\n`);
  const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  for (const args of [
    ["add", "-A"],
    ["-c", `user.email=${email}`, "-c", "user.name=Somebody Named", "commit", "-q", "-m", subject],
  ]) {
    const result = spawnSync("git", args, { cwd: repo.root, env, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
  }
};

const gate = (task: string, status: string, at: string): string =>
  signedLine(repoRuntime(), {
    schema: "finitemonkey/evidence@1",
    task,
    check: "*gate*",
    kind: "gate",
    status,
    treeHash: "t",
    at,
    notes: [],
  });

const contract = (id: string): string =>
  `id: ${id}\ngoal: ${id}\nsize: S\nscope:\n  paths: [src/]\nacceptance:\n  - id: t\n    check: command\n    run: npm test\n`;

const setup = (): Repo => {
  const repo = makeRepo();
  repos.push(repo);
  const people = ["ana@example.com", "bia@example.com", "caio@example.com"];
  people.forEach((email, index) => {
    commitAs(
      repo,
      email,
      `2026-09-0${String(index + 1)}T10:00:00Z`,
      `feat: part ${String(index)}`,
      `src/f${String(index)}.ts`,
    );
  });
  commitAs(repo, "ana@example.com", "2026-09-05T10:00:00Z", "fix: part 0 rounding", "src/f0.ts");
  commitAs(repo, "bia@example.com", "2026-09-06T10:00:00Z", 'Revert "feat: part 1"', "src/f1.ts");
  commitAs(repo, "ana@example.com", "2026-10-01T10:00:00Z", "feat: october", "src/oct.ts");
  repo.write(".finitemonkey/policy.yml", policyWith({ "team-dashboard": "shadow" }));
  repo.write(".finitemonkey/tasks/t1.yml", contract("t1"));
  repo.write(".finitemonkey/tasks/t2.yml", contract("t2"));
  repo.write(".finitemonkey/evidence/t1.jsonl", `${gate("t1", "passed", "2026-09-02T10:00:00.000Z")}\n`);
  repo.write(
    ".finitemonkey/evidence/t2.jsonl",
    `${gate("t2", "failed", "2026-09-03T10:00:00.000Z")}\n${gate("t2", "failed", "2026-09-03T11:00:00.000Z")}\n${gate("t2", "passed", "2026-09-03T12:00:00.000Z")}\n`,
  );
  return repo;
};

describe("team report", () => {
  it("matches counts taken straight from git history and the ledger", async () => {
    const repo = setup();
    const run = await cli(["team", "report", "--json"], { cwd: repo.root, runtime: repoRuntime() });
    const body = JSON.parse(run.stdout) as { data: { buckets: readonly Record<string, unknown>[] } };
    const september = body.data.buckets.find((bucket) => bucket["period"] === "2026-09");
    assert.ok(september);
    const direct = spawnSync("git", ["log", "--format=%cI%x09%s"], { cwd: repo.root, encoding: "utf8" })
      .stdout.trim()
      .split("\n")
      .filter((line) => line.startsWith("2026-09"))
      .map((line) => line.split("\t")[1] ?? "");
    assert.equal(september["commits"], direct.length);
    assert.equal(september["reverts"], direct.filter((subject) => subject.startsWith("Revert")).length);
    assert.equal(september["rework"], 1);
    assert.equal(september["tasks"], 2);
    assert.equal(september["falseDone"], 2);
    assert.equal(september["firstTry"], 1);
  });

  it("suppresses a month with fewer than k contributors", async () => {
    const repo = setup();
    const run = await cli(["team", "report", "--json"], { cwd: repo.root, runtime: repoRuntime() });
    const body = JSON.parse(run.stdout) as { data: { buckets: readonly Record<string, unknown>[] } };
    const october = body.data.buckets.find((bucket) => bucket["period"] === "2026-10");
    assert.ok(october);
    assert.equal(october["suppressed"], true);
    assert.equal(october["commits"], 0);
  });

  it("names no person anywhere in its output", async () => {
    const repo = setup();
    const human = await cli(["team", "report"], { cwd: repo.root, runtime: repoRuntime() });
    const json = await cli(["team", "report", "--json"], { cwd: repo.root, runtime: repoRuntime() });
    for (const text of [human.stdout, json.stdout])
      assert.doesNotMatch(text, /ana|bia|caio|example\.com|Somebody|Named/);
  });

  it("states every metric's definition and source in the method section", () => {
    const report = teamReport(readCommits(repoRuntime(), setup().root), [], []);
    for (const metric of [
      "falseDone",
      "firstTry",
      "rework",
      "reverts",
      "spendPerTask",
      "reviewTime",
      "securityFindings",
    ]) {
      const line = report.method.find((item) => item.metric === metric);
      assert.ok(line !== undefined && line.definition !== "" && line.source !== "");
    }
  });

  it("prints intervals with the sample size behind them", () => {
    assert.equal(wilson(0, 0), null);
    const interval = wilson(1, 2);
    assert.ok(interval !== null && interval.low < 0.5 && interval.high > 0.5);
  });
});
