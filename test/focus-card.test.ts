import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { Evidence } from "../src/evidence/types.js";
import { buildCard } from "../src/focus/card.js";
import { parseContract } from "../src/task/load.js";
import type { TaskContract } from "../src/task/types.js";
import { contextOf, fireHook, policyWith } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { signedLine } from "./signed.js";
import { cli } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const contractText = (id: string): string =>
  `id: ${id}\ngoal: fix billing totals\nsize: M\nscope:\n  paths: [src/billing/]\nacceptance:\n  - id: unit\n    check: command\n    run: npm test\n  - id: lint\n    check: command\n    run: npm run lint\n  - id: types\n    check: command\n    run: npx tsc\n`;

const contractOf = (id: string): TaskContract => {
  const parsed = parseContract(id, contractText(id));
  if (!parsed.ok) throw new Error("bad contract");
  return parsed.value;
};

const entry = (check: string, status: "passed" | "failed", at: string, command?: string): Evidence => ({
  schema: "finitemonkey/evidence@1",
  task: "billing",
  check,
  kind: "command",
  status,
  treeHash: "t1",
  at,
  notes: [],
  ...(command === undefined ? {} : { command }),
});

const LEDGER: readonly Evidence[] = [
  entry("unit", "failed", "2026-10-01T10:00:00.000Z", "npm test -- billing"),
  entry("lint", "passed", "2026-10-01T10:01:00.000Z"),
];

describe("focus card", () => {
  it("is built by rule: the first red criterion's reproduction comes first", () => {
    const card = buildCard(contractOf("billing"), LEDGER, { id: "d1", subject: "rounding" });
    assert.deepEqual(card.green, ["lint"]);
    assert.deepEqual(card.red, ["unit"]);
    assert.deepEqual(card.open, ["types"]);
    assert.deepEqual(card.next, { kind: "reproduce", check: "unit", command: "npm test -- billing" });
  });

  it("falls back to a pending decision and then to the gate", () => {
    const green = [entry("unit", "passed", "2026-10-01T11:00:00.000Z")];
    assert.equal(buildCard(contractOf("billing"), green, { id: "d1", subject: "rounding" }).next.kind, "decide");
    assert.equal(buildCard(contractOf("billing"), green, undefined).next.kind, "gate");
  });

  it("is identical for the same ledger and contract", () => {
    assert.deepEqual(
      buildCard(contractOf("billing"), LEDGER, undefined),
      buildCard(contractOf("billing"), LEDGER, undefined),
    );
  });
});

const setup = (extra: Readonly<Record<string, string>> = {}, policy = policyWith({ "focus-card": "active" })): Repo => {
  const runtime = repoRuntime();
  const lines = LEDGER.map((item) => signedLine(runtime, { ...item }));
  const repo = makeRepo({
    ".finitemonkey/tasks/billing.yml": contractText("billing"),
    ".finitemonkey/state.json": JSON.stringify({ schemaVersion: 1, active: "billing", done: [] }),
    ".finitemonkey/evidence/billing.jsonl": `${lines.join("\n")}\n`,
    ".finitemonkey/policy.yml": policy,
    ...extra,
  });
  repos.push(repo);
  return repo;
};

const nextLine = (text: string): string => text.split("\n").find((line) => line.startsWith("Next:")) ?? "";

describe("focus-card hooks", () => {
  it("shows the same next action after a compaction as before it", async () => {
    const repo = setup();
    const before = contextOf(await fireHook(repo, "SessionStart", { source: "startup" }));
    const afterCompact = contextOf(await fireHook(repo, "SessionStart", { source: "compact" }));
    assert.match(nextLine(before), /npm test -- billing/);
    assert.equal(nextLine(afterCompact), nextLine(before));
  });

  it("asks once to park an edit outside the task scope, and nothing more for the same area", async () => {
    const repo = setup();
    const edit = (file: string) =>
      fireHook(repo, "PostToolUse", { tool_name: "Edit", tool_input: { file_path: `${repo.root}/${file}` } });
    assert.equal(contextOf(await edit("src/billing/total.ts")), "");
    assert.match(contextOf(await edit("docs/ideas.md")), /outside the scope of task billing.*finitemonkey park/);
    assert.equal(contextOf(await edit("docs/other.md")), "");
  });

  it("suggests closing a project once above the limit and never blocks", async () => {
    const repo = setup(
      { ".finitemonkey/tasks/other.yml": contractText("other") },
      `${policyWith({ "focus-card": "active" })}person:\n  projectLimit: 1\n`,
    );
    const first = await fireHook(repo, "UserPromptSubmit", { prompt: "keep going" });
    assert.match(contextOf(first), /2 projects or fronts are open.*limit is 1/);
    assert.equal(first.exitCode, 0);
    assert.doesNotMatch(
      contextOf(await fireHook(repo, "UserPromptSubmit", { prompt: "and now?" })),
      /projects or fronts/,
    );
  });

  it("stays silent in shadow and only logs", async () => {
    const repo = setup({}, "");
    assert.doesNotMatch(contextOf(await fireHook(repo, "SessionStart", { source: "startup" })), /Where this stands/);
    assert.match(repo.read(".finitemonkey/log.jsonl"), /"feature":"focus-card"/);
  });
});

describe("parking lot", () => {
  it("parks an idea linked to the task and brings it back with one line", async () => {
    const repo = setup();
    const parked = await cli(["park", "try a cache for totals"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(parked.stdout, /Parked as p1/);
    assert.match(repo.read(".finitemonkey/parking.jsonl"), /"task":"billing"/);
    const listed = await cli(["park", "--list"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(listed.stdout, /p1: try a cache for totals/);
    const back = await cli(["unpark", "p1"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(back.code, 0);
    const empty = await cli(["park", "--list"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(empty.stdout, /No parked ideas/);
  });
});
