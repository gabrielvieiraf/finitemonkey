import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AbsolutePath } from "../src/core/brand.js";
import type { JsonObject } from "../src/core/parsed.js";
import { frontsPostToolUse, frontsPreToolUse } from "../src/fronts/hooks.js";
import { checkReport } from "../src/fronts/report-gate.js";
import { frontsPrompt, frontsSendMessage, isPersonPrompt } from "../src/fronts/routing.js";
import { type Front, readFronts, serializeState } from "../src/fronts/state.js";
import type { HookEvent } from "../src/hooks/events.js";
import type { HookHandler } from "../src/hooks/handlers.js";
import { runtime, t, tempRepo, write } from "./git-support.js";

const front = (id: string, agentId: string, paths: readonly string[]): Front => ({
  id,
  goal: id,
  contract: null,
  paths,
  append: [],
  i18nNs: null,
  worktree: id,
  path: null,
  branch: `front/${id}`,
  port: null,
  shotsPrefix: null,
  issue: null,
  agentId,
  agentKind: "subagent",
  status: "running",
  blockedBy: [],
  inbox: [],
  lastReport: null,
  costUsd: 0,
  startedAt: "2026-10-27T10:00:00Z",
});

const setup = (root: AbsolutePath): void => {
  write(
    root,
    ".finitemonkey/fronts.yml",
    serializeState({
      wave: 1,
      base: "main@abc",
      briefing: ".finitemonkey/briefing.md",
      maxConcurrent: 3,
      budgetUsd: null,
      budgetMinutes: null,
      fronts: [
        front("F1-checkout", "agent-1", ["src/checkout/**"]),
        front("F2-invites", "agent-2", ["src/invites/**"]),
      ],
      pending: [],
    }),
  );
};

const fire = async (handler: HookHandler, event: HookEvent, root: AbsolutePath, raw: JsonObject) =>
  handler({
    event,
    cwd: root,
    runtime,
    t,
    env: { CLAUDE_PROJECT_DIR: root },
    payload: {
      hookEventName: event,
      sessionId: "main",
      cwd: root,
      stopHookActive: false,
      raw: { session_id: "main", ...raw },
    },
  });

const send = (to: string, message: string): JsonObject => ({ tool_name: "SendMessage", tool_input: { to, message } });

const frontNamed = (root: AbsolutePath, id: string): Front => {
  const state = readFronts(runtime, root);
  assert.ok(state.ok);
  const found = state.value.fronts.find((item) => item.id === id);
  assert.ok(found);
  return found;
};

describe("orchestrate: routing the person's messages", () => {
  it("a correction goes to the running front without restarting it", async () => {
    const repo = tempRepo();
    try {
      setup(repo.root);
      const before = frontNamed(repo.root, "F1-checkout");
      const context = JSON.stringify(
        await fire(frontsPrompt, "UserPromptSubmit", repo.root, { prompt: "make the pay button green on checkout" }),
      );
      assert.match(context, /F1-checkout \[running\] src\/checkout/);
      assert.match(context, /F2-invites \[running\] src\/invites/);
      const relaunch = {
        tool_name: "Agent",
        tool_input: { prompt: "Read the briefing.\nFront: F1-checkout\nGoal: green button", isolation: "worktree" },
      };
      const blocked = await fire(frontsPreToolUse, "PreToolUse", repo.root, relaunch);
      assert.ok(blocked.kind === "block");
      assert.match(blocked.reason, /already running/);
      await fire(frontsSendMessage, "PostToolUse", repo.root, send("agent-1", "make the pay button green"));
      const after = frontNamed(repo.root, "F1-checkout");
      assert.equal(after.agentId, before.agentId);
      assert.equal(after.startedAt, before.startedAt);
      assert.equal(after.status, "running");
      assert.deepEqual(
        after.inbox.map((item) => item.text),
        ["make the pay button green"],
      );
      assert.deepEqual(frontNamed(repo.root, "F2-invites").inbox, []);
    } finally {
      repo.dispose();
    }
  });

  it("routed messages appear in the inbox and the front report has to answer them", async () => {
    const repo = tempRepo();
    try {
      setup(repo.root);
      await fire(frontsSendMessage, "PostToolUse", repo.root, send("F2-invites", "invites expire in 7 days"));
      const base = {
        front: "F2-invites",
        branch: "front/F2-invites",
        head: "abcdef123456",
        commits: [],
        delivered: ["invites"],
        endpoints: [],
        tests: { command: "", passed: 0, failed: 0, added: 0 },
        screenshots: [],
        left_out: [],
        provisional_decisions: [],
        evidence: "",
      };
      write(repo.root, ".finitemonkey/reports/F2-invites.json", JSON.stringify(base));
      const missing = checkReport(runtime, repo.root, frontNamed(repo.root, "F2-invites"));
      assert.ok(missing.problems.some((problem) => problem.includes("invites expire in 7 days")));
      write(
        repo.root,
        ".finitemonkey/reports/F2-invites.json",
        JSON.stringify({
          ...base,
          inbox: [{ at: "x", text: "invites expire in 7 days", done: "set the expiry to 7 days" }],
        }),
      );
      assert.deepEqual(checkReport(runtime, repo.root, frontNamed(repo.root, "F2-invites")).problems, []);
    } finally {
      repo.dispose();
    }
  });

  it("front notifications and other sessions are not the person's prompts", async () => {
    const repo = tempRepo();
    try {
      setup(repo.root);
      for (const prompt of [
        "<task-notification><task-id>abc</task-id><status>completed</status></task-notification>",
        "[SYSTEM NOTIFICATION - NOT USER INPUT] agent finished",
        "[julius2claude] resume the session",
      ]) {
        assert.equal(isPersonPrompt(prompt), false, prompt);
        assert.deepEqual(await fire(frontsPrompt, "UserPromptSubmit", repo.root, { prompt }), { kind: "allow" });
      }
      assert.equal(isPersonPrompt("also add a footer to invites"), true);
    } finally {
      repo.dispose();
    }
  });

  it("a new front must be launched with isolation worktree", async () => {
    const repo = tempRepo();
    try {
      setup(repo.root);
      const state = readFronts(runtime, repo.root);
      assert.ok(state.ok);
      write(
        repo.root,
        ".finitemonkey/fronts.yml",
        serializeState({
          ...state.value,
          fronts: [
            ...state.value.fronts,
            { ...front("F3-report", "", ["src/report/**"]), agentId: null, status: "planned" },
          ],
        }),
      );
      const bare = await fire(frontsPreToolUse, "PreToolUse", repo.root, {
        tool_name: "Agent",
        tool_input: { prompt: "Front: F3-report" },
      });
      assert.ok(bare.kind === "block");
      assert.match(bare.reason, /isolation/);
      const isolated = { tool_name: "Agent", tool_input: { prompt: "Front: F3-report", isolation: "worktree" } };
      assert.equal((await fire(frontsPreToolUse, "PreToolUse", repo.root, isolated)).kind, "allow");
      await fire(frontsPostToolUse, "PostToolUse", repo.root, isolated);
      assert.equal(frontNamed(repo.root, "F3-report").status, "running");
    } finally {
      repo.dispose();
    }
  });
});
