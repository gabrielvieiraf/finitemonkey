import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import { checkBriefing } from "../src/doctor/briefing.js";
import { BRIEFING_MAX_LINES, frontPrompt, lineCount, renderBriefing } from "../src/fronts/brief.js";
import { type Front, serializeState } from "../src/fronts/state.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { readState, writeState } from "../src/task/state.js";
import { runtime, t, tempRepo, write } from "./git-support.js";
import { fakeRuntime, field, parseBody, stdinFrom } from "./support.js";

const front = (id: string, contract: string | null): Front => ({
  id,
  goal: "Checkout with Pix",
  contract,
  paths: ["src/checkout/**"],
  append: ["src/routes.ts"],
  i18nNs: "checkout",
  worktree: id,
  path: `/work/${id}`,
  branch: `front/${id}`,
  port: 5174,
  shotsPrefix: "f1-",
  issue: null,
  agentId: null,
  agentKind: "subagent",
  status: "running",
  blockedBy: [],
  inbox: [{ at: "10:00", text: "use the green button" }],
  lastReport: null,
  costUsd: 0,
  startedAt: null,
});

const task = (root: AbsolutePath, id: string, goal: string): void => {
  const made = createTask(runtime, fmPaths(root), {
    id,
    goal,
    size: "L",
    base: undefined,
    paths: ["src/**"],
    runs: [],
    tests: "npm test",
    git: [],
    manual: [],
    budget: undefined,
  });
  assert.ok(made.ok);
};

const subagentStart = async (root: AbsolutePath, agentType: string): Promise<string> => {
  const outcome = await runHook("SubagentStart", {
    stdin: stdinFrom(
      JSON.stringify({
        hook_event_name: "SubagentStart",
        session_id: "main",
        cwd: root,
        agent_id: "agent-1",
        agent_type: agentType,
      }),
    ),
    deadlineMs: 5000,
    handlers: DEFAULT_HANDLERS,
    cwd: root,
    t,
    startTimer: runtime.startTimer,
    runtime,
  });
  const context = field(
    parseBody(outcome.stdout === "" ? "{}" : outcome.stdout),
    "hookSpecificOutput",
    "additionalContext",
  );
  return typeof context === "string" ? context : "";
};

const wave = (root: AbsolutePath): void => {
  write(
    root,
    ".finitemonkey/fronts.yml",
    serializeState({
      wave: 1,
      base: "main@abc1234",
      briefing: ".finitemonkey/briefing.md",
      maxConcurrent: 3,
      budgetUsd: null,
      budgetMinutes: null,
      fronts: [front("F1-checkout", ".finitemonkey/tasks/f1-checkout.yml")],
      pending: ["F1-checkout"],
    }),
  );
};

describe("SubagentStart for fronts", () => {
  it("the front's block and contract reach the subagent, not the main session's task", async () => {
    const repo = tempRepo();
    try {
      task(repo.root, "main-task", "Main session goal");
      task(repo.root, "f1-checkout", "Pix checkout contract");
      writeState(runtime, fmPaths(repo.root), { ...readState(runtime, fmPaths(repo.root)), active: "main-task" });
      wave(repo.root);
      const context = await subagentStart(repo.root, "general-purpose");
      assert.match(context, /Front F1-checkout: Checkout with Pix/);
      assert.match(context, /Pix checkout contract/);
      assert.match(context, /src\/checkout\/\*\*/);
      assert.match(context, /use the green button/);
      assert.match(context, /\.finitemonkey\/reports\/F1-checkout\.json/);
      assert.doesNotMatch(context, /Main session goal/);
    } finally {
      repo.dispose();
    }
  });

  for (const type of ["reviewer", "verifier", "researcher"]) {
    it(`nothing is injected into ${type}`, async () => {
      const repo = tempRepo();
      try {
        task(repo.root, "main-task", "Main session goal");
        writeState(runtime, fmPaths(repo.root), { ...readState(runtime, fmPaths(repo.root)), active: "main-task" });
        wave(repo.root);
        assert.equal(await subagentStart(repo.root, type), "");
      } finally {
        repo.dispose();
      }
    });
  }
});

describe("briefing", () => {
  it("stays under its ceiling and the front prompt is four lines", () => {
    const root = toAbsolutePath("/home/ana/app");
    const fake = fakeRuntime({
      files: { [`${root}/package.json`]: JSON.stringify({ scripts: { build: "x", test: "y", lint: "z" } }) },
    });
    const text = renderBriefing(fake, root, {
      wave: 2,
      base: "main@abc1234",
      briefing: ".finitemonkey/briefing.md",
      maxConcurrent: 3,
      budgetUsd: null,
      budgetMinutes: null,
      fronts: [],
      pending: [],
    });
    assert.ok(lineCount(text) <= BRIEFING_MAX_LINES, String(lineCount(text)));
    for (const heading of [
      "## Rules",
      "## Required reading",
      "## How to build",
      "## How to verify",
      "## Report",
      "## Human decisions",
    ]) {
      assert.ok(text.includes(heading), heading);
    }
    assert.match(text, /`npm run test`/);
    assert.equal(frontPrompt(front("F1", null)).split("\n").length, 4);
  });

  it("doctor warns when the briefing passes the ceiling", () => {
    const root = toAbsolutePath("/home/ana/app");
    const long = Array.from({ length: BRIEFING_MAX_LINES + 5 }, (_, index) => `line ${String(index)}`).join("\n");
    const env = (text: string) => ({
      platform: "linux" as const,
      env: {},
      cwd: root,
      root,
      version: "1.0.0",
      runtime: fakeRuntime({ files: { [`${root}/.finitemonkey/briefing.md`]: text } }),
    });
    assert.equal(checkBriefing(env(long))[0]?.status, "warn");
    assert.equal(checkBriefing(env("short\n"))[0]?.status, "ok");
  });
});
