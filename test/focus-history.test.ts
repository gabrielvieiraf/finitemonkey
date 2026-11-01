import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { historyLimit, proposeLimit, type WeekLoad, weekStart } from "../src/focus/limit.js";
import { pathMentions } from "../src/focus/scope.js";
import { knownTasks } from "../src/guardian/tasks.js";
import { fmPaths } from "../src/task/paths.js";
import { contextOf, fireHook, policyWith } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { signedLine } from "./signed.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const DAY = 86_400_000;
const MONDAY = Date.UTC(2026, 8, 7, 9);
const NOW = new Date(MONDAY + 28 * DAY).toISOString();

const contractText = (id: string): string =>
  `id: ${id}\ngoal: ${id}\nsize: M\nscope:\n  paths: [src/billing/]\nacceptance:\n  - id: t\n    check: command\n    run: npm test\n`;

const ledger = (task: string, days: readonly number[], gateDay?: number): string => {
  const runtime = repoRuntime();
  const line = (check: string, status: string, day: number): string =>
    signedLine(runtime, {
      schema: "finitemonkey/evidence@1",
      task,
      check,
      kind: check === "*gate*" ? "gate" : "command",
      status,
      treeHash: "t",
      at: new Date(MONDAY + day * DAY).toISOString(),
      notes: [],
    });
  const lines = [
    ...days.map((day) => line("t", "failed", day)),
    ...(gateDay === undefined ? [] : [line("*gate*", "passed", gateDay)]),
  ];
  return `${lines.join("\n")}\n`;
};

const HISTORY: Readonly<Record<string, readonly [readonly number[], number | undefined]>> = {
  a: [[0, 1], 2],
  b: [[1, 3], 4],
  c: [[7, 8], 9],
  d: [[8, 10], 11],
  e: [[14, 15, 16], undefined],
  f: [[14], undefined],
  g: [[14, 15], undefined],
};

const files = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(HISTORY).flatMap(([id, [days, gate]]) => [
      [`.finitemonkey/tasks/${id}.yml`, contractText(id)],
      [`.finitemonkey/evidence/${id}.jsonl`, ledger(id, days, gate)],
    ]),
  );

const setup = (extra: Readonly<Record<string, string>> = {}): Repo => {
  const repo = makeRepo({
    ...files(),
    ".finitemonkey/policy.yml": `${policyWith({ "focus-card": "active" })}person:\n  projectLimit: 5\n`,
    ".finitemonkey/state.json": JSON.stringify({ schemaVersion: 1, active: "e", done: ["a", "b", "c", "d"] }),
    ...extra,
  });
  repos.push(repo);
  return repo;
};

describe("project limit from history", () => {
  it("proposes a limit from a history fixture with the weeks it used", () => {
    const repo = setup();
    const runtime = repoRuntime({ now: () => NOW });
    const proposal = historyLimit(runtime, fmPaths(repo.root), knownTasks(runtime, fmPaths(repo.root)));
    assert.equal(proposal?.limit, 2);
    assert.deepEqual(
      proposal.weeks.map((week) => [week.week, week.open, week.finished, week.stalled]),
      [
        ["2026-09-07", 2, 2, 0],
        ["2026-09-14", 2, 2, 0],
        ["2026-09-28", 3, 0, 3],
      ],
    );
  });

  it("lowers the proposal below a week where three open projects stalled", () => {
    const load = (week: string, open: number, finished: number, stalled: number): WeekLoad => ({
      week,
      open,
      finished,
      stalled,
    });
    assert.equal(proposeLimit([load("w1", 3, 1, 0), load("w2", 3, 2, 0), load("w3", 3, 0, 2)])?.limit, 2);
    assert.equal(proposeLimit([load("w1", 3, 1, 0)]), undefined);
  });

  it("starts weeks on Monday", () => {
    assert.equal(new Date(weekStart(Date.UTC(2026, 8, 13, 23))).toISOString().slice(0, 10), "2026-09-07");
  });

  it("shows the proposal once at session start and leaves the setting to the person", async () => {
    const repo = setup();
    const runtime = repoRuntime({ now: () => NOW });
    const first = contextOf(await fireHook(repo, "SessionStart", { source: "startup" }, runtime));
    assert.match(first, /history suggests a limit of 2 open projects.*2026-09-07 \(2\).*person\.projectLimit: 2/);
    const again = contextOf(await fireHook(repo, "SessionStart", { source: "startup" }, runtime));
    assert.doesNotMatch(again, /history suggests/);
    assert.match(repo.read(".finitemonkey/policy.yml"), /projectLimit: 5/);
  });
});

describe("out-of-scope requests in the prompt", () => {
  it("finds paths named in a prompt, not prose or URLs", () => {
    const exists = (file: string): boolean => file === "README.md" || file === "docs";
    assert.deepEqual(
      pathMentions(
        "update `src/billing/total.ts`, then docs/ideas.md, README.md and docs (and/or https://x.io/a.ts).",
        exists,
      ),
      ["src/billing/total.ts", "docs/ideas.md", "README.md"],
    );
  });

  it("asks once for a file outside scope and never again for the same deviation", async () => {
    const repo = setup({ "docs/ideas.md": "x\n" });
    const ask = async (prompt: string): Promise<string> =>
      contextOf(await fireHook(repo, "UserPromptSubmit", { prompt }, repoRuntime({ now: () => NOW })));
    assert.doesNotMatch(await ask("fix src/billing/total.ts"), /outside the scope/);
    assert.match(await ask("also rewrite docs/ideas.md please"), /docs\/ideas\.md is outside the scope of task e/);
    assert.doesNotMatch(await ask("and docs/other.md too"), /outside the scope/);
    const edit = await fireHook(repo, "PostToolUse", {
      tool_name: "Edit",
      tool_input: { file_path: `${repo.root}/docs/ideas.md` },
    });
    assert.doesNotMatch(contextOf(edit), /outside the scope/);
  });
});
