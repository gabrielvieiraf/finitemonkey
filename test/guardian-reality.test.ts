import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { readDecisions } from "../src/guardian/decisions.js";
import { type RealityReport, showable } from "../src/guardian/report.js";
import { fmPaths } from "../src/task/paths.js";
import { contextOf, denied, fireHook, policyWith, silent } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const contract = (goal: string, paths = "[src/billing/]"): string =>
  `id: work\ngoal: ${goal}\nscope:\n  paths: ${paths}\nacceptance:\n  - id: t\n    check: command\n    run: npm test\n`;

const GOALS = [
  "non_goals:",
  "  - id: n1",
  "    text: mobile app",
  "    origin: stated",
  "  - id: n2",
  "    text: billing dashboard",
  "    origin: inferred",
  "",
].join("\n");

const setup = (goal: string, extra: Readonly<Record<string, string>> = {}): Repo => {
  const repo = makeRepo({
    ".finitemonkey/tasks/work.yml": contract(goal),
    ".finitemonkey/state.json": JSON.stringify({ schemaVersion: 1, active: "work", done: [] }),
    ".finitemonkey/goals.yml": GOALS,
    ".finitemonkey/policy.yml": policyWith({ reality: "active" }),
    ...extra,
  });
  repos.push(repo);
  return repo;
};

const edit = (repo: Repo, file: string) =>
  fireHook(repo, "PreToolUse", {
    tool_name: "Write",
    tool_input: { file_path: `${repo.root}/${file}`, content: "export const x = 1;\n" },
  });

const prompt = (repo: Repo, text: string) => fireHook(repo, "UserPromptSubmit", { prompt: text });

const REPORT: RealityReport = {
  trigger: "goal_conflict",
  level: 2,
  perceivedGoal: "g",
  request: "r",
  finding: "f",
  evidence: [],
  assumptions: [],
  consequences: "c",
  alternatives: ["a"],
  recommendation: "x",
  certainty: "medium",
  nextStep: "n",
  paths: [],
  key: "k",
};

describe("reality report and intervention levels", () => {
  it("a report without evidence lines is never shown", () => {
    assert.equal(showable(REPORT), false);
    assert.equal(showable({ ...REPORT, evidence: ["  "] }), false);
    assert.equal(showable({ ...REPORT, evidence: [".finitemonkey/goals.yml: non_goals n1"] }), true);
  });

  it("level 2: a task matching a stated non-goal gets a report once, with evidence", async () => {
    const repo = setup("build the mobile app login");
    const first = await edit(repo, "src/billing/a.ts");
    assert.equal(denied(first), true);
    assert.match(contextOf(first), /Evidence:[\s\S]*goals\.yml: non_goals n1 "mobile app"/);
    assert.equal(denied(await edit(repo, "src/billing/b.ts")), false);
    assert.equal(readDecisions(repoRuntime(), fmPaths(repo.root))[0]?.trigger, "goal_conflict");
  });

  it("runs without a word when the only matching non-goal is inferred", async () => {
    const repo = setup("show the billing dashboard");
    assert.equal(silent(await edit(repo, "src/billing/a.ts")), true);
  });

  it("level 1: scope growth after approval is a note, and an unchanged contract runs silently", async () => {
    const approved = JSON.stringify({ contracts: {}, approved: { work: contract("charge cards") } });
    const grown = setup("charge cards", {
      ".finitemonkey/trust.json": approved,
      ".finitemonkey/tasks/work.yml": contract("charge cards", "[src/billing/, src/auth/]"),
    });
    const note = await edit(grown, "src/billing/a.ts");
    assert.equal(denied(note), false);
    assert.match(contextOf(note), /level 1 \(scope_growth\)[\s\S]*\+src\/auth\//);
    const same = setup("charge cards", { ".finitemonkey/trust.json": approved });
    assert.equal(silent(await edit(same, "src/billing/a.ts")), true);
  });

  it("level 3: records the person's criterion before showing the recommendation", async () => {
    const repo = setup("charge cards");
    const migrate = { tool_name: "Bash", tool_input: { command: "npx prisma migrate deploy" } };
    const ask = await fireHook(repo, "PreToolUse", migrate);
    assert.equal(denied(ask), true);
    assert.match(contextOf(ask), /finitemonkey: criterion/);
    assert.doesNotMatch(contextOf(ask), /Recommendation/);
    await prompt(repo, "finitemonkey: criterion no downtime for paying clubs");
    const shown = await fireHook(repo, "PreToolUse", migrate);
    assert.equal(denied(shown), true);
    const text = contextOf(shown);
    assert.ok(text.indexOf("no downtime for paying clubs") < text.indexOf("Recommendation"));
    assert.equal(readDecisions(repoRuntime(), fmPaths(repo.root))[0]?.criterion, "no downtime for paying clubs");
    assert.equal(denied(await fireHook(repo, "PreToolUse", migrate)), false);
  });

  it("runs without a word on a reversible command and starts in shadow", async () => {
    const repo = setup("charge cards");
    assert.equal(
      silent(await fireHook(repo, "PreToolUse", { tool_name: "Bash", tool_input: { command: "npm test" } })),
      true,
    );
    const shadow = setup("build the mobile app", { ".finitemonkey/policy.yml": "level: standard\n" });
    assert.equal(denied(await edit(shadow, "src/billing/a.ts")), false);
    assert.equal(readDecisions(repoRuntime(), fmPaths(shadow.root)).length, 0);
  });

  it("guardian report prints the same reports on request", async () => {
    const repo = setup("build the mobile app login");
    const run = await cli(["guardian", "report"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(run.stdout, /level 2 \(goal_conflict\)/);
    const quiet = setup("charge cards");
    assert.match((await cli(["guardian", "report"], { cwd: quiet.root, runtime: repoRuntime() })).stdout, /No report/);
  });
});
