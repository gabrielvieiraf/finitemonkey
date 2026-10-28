import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import { ADVISOR_HANDLERS } from "../src/advisor/hook.js";
import { dismissedSpots, latest, mutedFor, readHistory, ruleRates } from "../src/advisor/store.js";
import type { Suggestion } from "../src/advisor/types.js";
import type { TextSource } from "../src/core/context.js";
import { writeGateStatus } from "../src/gate/hooks/status.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field, ROOT, stdinFrom } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const BILLING = readFileSync(join(ROOT, "test", "fixtures", "advisor", "billing.ts.txt"), "utf8");
const WIDE = (name: string): string =>
  `export const ${name} = (a: number, b: number, c: number, d: number, e: number): number => a + b + c + d + e;\n`;

const project = (test = 'node -e "process.exit(0)"'): Repo => {
  const repo = makeRepo({
    ".finitemonkey/policy.yml":
      "guards:\n  quality: active\n  slop: active\n  tests-hold: active\n  regression: active\n  advisor: active\n  reminders: active\n  learnings: active\n  rules-stop: active\n",
    "package.json": JSON.stringify({ scripts: { test } }),
    "src/billing.ts": "export const placeholder = 1;\n",
    ".finitemonkey/config.yml": "lang: en\n",
  });
  repos.push(repo);
  return repo;
};

const stop = (repo: Repo, task = "implicit") => {
  const runtime = repoRuntime();
  writeGateStatus(runtime, fmPaths(repo.root), { status: "passed", task, detail: "" });
  return runHook("Stop", {
    stdin: stdinFrom(JSON.stringify({ hook_event_name: "Stop", session_id: "s1", cwd: repo.root })),
    deadlineMs: 20_000,
    handlers: ADVISOR_HANDLERS,
    cwd: repo.root,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });
};

const snapshot = (repo: Repo): string =>
  repo
    .git("ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ".", ":(exclude).finitemonkey")
    .split("\0")
    .filter((file) => file !== "")
    .map((file) => `${file}\n${repo.read(file)}`)
    .join("\n--\n");

const suggestions = (repo: Repo): readonly Suggestion[] => latest(readHistory(repoRuntime(), repo.root));

const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

describe("advisor at Stop", () => {
  it("never edits a file", async () => {
    const repo = project();
    repo.write("src/billing.ts", BILLING);
    const before = snapshot(repo);
    const outcome = await stop(repo);
    assert.equal(outcome.verdict, "allow");
    assert.equal(snapshot(repo), before);
    assert.match(outcome.stdout, /refactoring suggestion/);
  });

  it("gives at most 3 suggestions, ranked, each naming its metric, refactoring and an example when one exists", async () => {
    const repo = project();
    repo.write("src/billing.ts", `${BILLING}${WIDE("wideOne")}${WIDE("wideTwo")}${WIDE("wideThree")}`);
    await stop(repo);
    const found = suggestions(repo);
    assert.equal(found.length, 3);
    assert.deepEqual(
      found.map((item) => item.score),
      [...found.map((item) => item.score)].sort((a, b) => b - a),
    );
    const nesting = found.find((item) => item.name === "invoiceTotal");
    assert.equal(nesting?.rule, "deep_nesting");
    assert.equal(nesting.metric, "nesting");
    assert.equal(nesting.refactoring, "Replace Nested Conditional with Guard Clauses");
    assert.match(nesting.example ?? "", /^src\/billing\.ts:\d+ invoice(Label|Code)$/);
    const params = found.find((item) => item.name === "createInvoice");
    assert.equal(params?.refactoring, "Introduce Parameter Object");
    assert.match(params.example ?? "", /createReceipt$/);
  });

  it("shows nothing while the gate is not green", async () => {
    const repo = project();
    repo.write("src/billing.ts", BILLING);
    const runtime = repoRuntime();
    writeGateStatus(runtime, fmPaths(repo.root), { status: "failed", task: "implicit", detail: "" });
    const outcome = await runHook("Stop", {
      stdin: stdinFrom(JSON.stringify({ hook_event_name: "Stop", session_id: "s1", cwd: repo.root })),
      deadlineMs: 20_000,
      handlers: ADVISOR_HANDLERS,
      cwd: repo.root,
      t: createTranslator("en"),
      startTimer: runtime.startTimer,
      runtime,
      env: {},
    });
    assert.doesNotMatch(outcome.stdout, /suggestion/);
    assert.deepEqual(suggestions(repo), []);
  });
});

describe("accepting and dismissing", () => {
  it("an accepted suggestion closes only when the checks pass before and after", async () => {
    const repo = project();
    repo.write("src/billing.ts", BILLING);
    await stop(repo);
    const first = suggestions(repo)[0];
    assert.ok(first !== undefined);
    const accepted = await cliJson(["suggest", "accept", first.id], {
      cwd: repo.root,
      stdin: tty(),
      runtime: repoRuntime(),
    });
    assert.equal(accepted.code, 0, accepted.stdout);
    const task = String(field(accepted.body, "data", "refactorTask"));
    await stop(repo, task);
    assert.equal(suggestions(repo).find((item) => item.id === first.id)?.state, "closed");
  });

  it("stays open when the checks were red before the refactoring", async () => {
    const repo = project('node -e "process.exit(1)"');
    repo.write("src/billing.ts", BILLING);
    await stop(repo);
    const first = suggestions(repo)[0];
    assert.ok(first !== undefined);
    const accepted = await cliJson(["suggest", "accept", first.id], {
      cwd: repo.root,
      stdin: tty(),
      runtime: repoRuntime(),
    });
    const runs = field(accepted.body, "data", "before");
    assert.ok(Array.isArray(runs) && runs.some((run) => field(run, "exitCode") === 1));
    await stop(repo, String(field(accepted.body, "data", "refactorTask")));
    assert.equal(suggestions(repo).find((item) => item.id === first.id)?.state, "accepted");
  });

  it("only the person accepts or dismisses, and a dismissal is remembered per rule and file", async () => {
    const repo = project();
    repo.write("src/billing.ts", BILLING);
    await stop(repo);
    const first = suggestions(repo)[0];
    assert.ok(first !== undefined);
    const byModel = await cliJson(["suggest", "dismiss", first.id], {
      cwd: repo.root,
      env: { CLAUDECODE: "1" },
      runtime: repoRuntime(),
    });
    assert.equal(byModel.code, 4);
    assert.equal(
      (await cliJson(["suggest", "dismiss", first.id], { cwd: repo.root, stdin: tty(), runtime: repoRuntime() })).code,
      0,
    );
    repo.write("src/billing.ts", `${BILLING}\n`);
    await stop(repo);
    const again = suggestions(repo).filter((item) => item.rule === first.rule && item.file === first.file);
    assert.deepEqual(
      again.map((item) => item.state),
      ["dismissed"],
    );
  });
});

const item = (overrides: Partial<Suggestion>): Suggestion => ({
  id: "S1",
  at: "2026-10-28T00:00:00.000Z",
  task: "implicit",
  rule: "long_function",
  file: "src/a.ts",
  line: 1,
  name: "a",
  metric: "lines",
  value: 80,
  target: 60,
  refactoring: "Extract Function",
  score: 1,
  state: "open",
  ...overrides,
});

describe("dismissal memory", () => {
  it("mutes a rule after 3 dismissals by the same person and retires one over 10% after 10 shown", () => {
    const dismissed = [1, 2, 3].map((n) =>
      item({ id: `S${String(n)}`, file: `src/${String(n)}.ts`, state: "dismissed", by: "ana" }),
    );
    assert.ok(mutedFor(dismissed, "ana").has("long_function"));
    assert.ok(!mutedFor(dismissed, "bia").has("long_function"));
    assert.ok(dismissedSpots(dismissed).has("long_function\u0000src/1.ts"));
    const shown = Array.from({ length: 9 }, (_, n) => item({ id: `S${String(n + 10)}` }));
    assert.equal(
      ruleRates([...shown, dismissed[0] ?? item({})]).find((rate) => rate.rule === "long_function")?.retired,
      false,
    );
    assert.equal(ruleRates([...shown, ...dismissed]).find((rate) => rate.rule === "long_function")?.retired, true);
  });
});
