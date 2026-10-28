import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { describe, it } from "node:test";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import type { JsonObject } from "../src/core/parsed.js";
import { EVIDENCE_SCHEMA } from "../src/evidence/types.js";
import { frontNotification, frontReportHandback, frontReportStop } from "../src/fronts/report-hooks.js";
import { type Front, readFronts, serializeState } from "../src/fronts/state.js";
import { gitAt, treeHash } from "../src/gate/git.js";
import type { HookEvent } from "../src/hooks/events.js";
import type { HookHandler } from "../src/hooks/handlers.js";
import { git, runtime, t, tempRepo, write } from "./git-support.js";

interface Wave {
  readonly root: AbsolutePath;
  readonly front: (id: string) => AbsolutePath;
  readonly dispose: () => void;
}

const frontOf = (id: string, path: string, agentId: string): Front => ({
  id,
  goal: id,
  contract: null,
  paths: ["src/**"],
  append: [],
  i18nNs: null,
  worktree: id,
  path,
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
  startedAt: null,
});

const setup = (ids: readonly string[]): Wave => {
  const repo = tempRepo({ "src/app.ts": "export const app = 1;\n" });
  const paths = ids.map((id) => toAbsolutePath(`${repo.root}-${id}`));
  ids.forEach((id, index) => {
    const path = paths[index] ?? repo.root;
    git(repo.root, "worktree", "add", "-q", path, "-b", `front/${id}`);
    write(path, `src/${id}.ts`, `export const ${id.replace(/\W/g, "")} = 1;\n`);
    git(path, "add", "-A");
    git(path, "commit", "-q", "-m", `feat: ${id}`);
    const tree = treeHash(gitAt(runtime, path)) ?? "";
    const entry = {
      schema: EVIDENCE_SCHEMA,
      task: id,
      check: "tests",
      kind: "tests",
      status: "passed",
      treeHash: tree,
      at: "2026-10-27T10:00:00Z",
      notes: [],
      testCount: 41,
    };
    write(path, `.finitemonkey/evidence/${id}.jsonl`, `${JSON.stringify(entry)}\n`);
  });
  const state = {
    wave: 1,
    base: "main@abc",
    briefing: ".finitemonkey/briefing.md",
    maxConcurrent: 3,
    budgetUsd: null,
    budgetMinutes: null,
    fronts: ids.map((id, index) => frontOf(id, paths[index] ?? "", `agent-${id}`)),
    pending: [],
  };
  write(repo.root, ".finitemonkey/fronts.yml", serializeState(state));
  return {
    root: repo.root,
    front: (id) => paths[ids.indexOf(id)] ?? repo.root,
    dispose: () => {
      repo.dispose();
      for (const path of paths) rmSync(path, { recursive: true, force: true });
    },
  };
};

const report = (wave: Wave, id: string, overrides: JsonObject = {}): void => {
  const path = wave.front(id);
  write(
    path,
    `.finitemonkey/reports/${id}.json`,
    JSON.stringify({
      front: id,
      branch: `front/${id}`,
      head: git(path, "rev-parse", "HEAD"),
      commits: [git(path, "log", "-1", "--format=%h %s")],
      delivered: ["checkout screen"],
      endpoints: [],
      tests: { command: "npm test", passed: 41, failed: 0, added: 6 },
      screenshots: [],
      left_out: [],
      provisional_decisions: [],
      evidence: `.finitemonkey/evidence/${id}.jsonl`,
      ...overrides,
    }),
  );
};

const fire = async (handler: HookHandler, event: HookEvent, wave: Wave, raw: JsonObject) =>
  handler({
    event,
    cwd: wave.root,
    runtime,
    t,
    env: { CLAUDE_PROJECT_DIR: wave.root },
    payload: {
      hookEventName: event,
      sessionId: "main",
      cwd: wave.root,
      stopHookActive: false,
      raw: { session_id: "main", ...raw },
    },
  });

const stop = (wave: Wave, id: string) => fire(frontReportStop, "SubagentStop", wave, { agent_id: `agent-${id}` });

const statusOf = (wave: Wave, id: string): string => {
  const state = readFronts(runtime, wave.root);
  assert.ok(state.ok);
  return state.value.fronts.find((front) => front.id === id)?.status ?? "";
};

describe("front-report gate", () => {
  it("rejects a report with a false test count and accepts the true one", async () => {
    const wave = setup(["F1"]);
    try {
      report(wave, "F1", { tests: { command: "npm test", passed: 50, failed: 0, added: 6 } });
      const decision = await stop(wave, "F1");
      assert.ok(decision.kind === "block");
      assert.match(decision.reason, /claims 50 tests, the ledger ran 41/);
      report(wave, "F1");
      assert.equal((await stop(wave, "F1")).kind, "allow");
      assert.equal(statusOf(wave, "F1"), "reported");
    } finally {
      wave.dispose();
    }
  });

  it("a dirty front worktree without left_out blocks SubagentStop; listing it in left_out passes", async () => {
    const wave = setup(["F1"]);
    try {
      write(wave.front("F1"), "src/draft.ts", "export const draft = 1;\n");
      report(wave, "F1");
      const decision = await stop(wave, "F1");
      assert.ok(decision.kind === "block");
      assert.match(decision.reason, /uncommitted src\/draft\.ts/);
      report(wave, "F1", {
        left_out: [{ what: "draft helper", why: "needs a product decision" }],
        finished: false,
        tests: { command: "", passed: 0, failed: 0, added: 0 },
      });
      assert.equal((await stop(wave, "F1")).kind, "allow");
    } finally {
      wave.dispose();
    }
  });

  it("the head must be the worktree HEAD and SubagentHandback is held the same way", async () => {
    const wave = setup(["F1"]);
    try {
      report(wave, "F1", { head: "0000000000" });
      const handback = await fire(frontReportHandback, "PreToolUse", wave, {
        agent_id: "agent-F1",
        tool_name: "SubagentHandback",
        tool_input: { message: "done" },
      });
      assert.ok(handback.kind === "block");
      assert.match(handback.reason, /head: the report says 0000000000/);
    } finally {
      wave.dispose();
    }
  });

  it("the block ceiling counts per front", async () => {
    const wave = setup(["F1", "F2"]);
    try {
      report(wave, "F1", { tests: { command: "npm test", passed: 99, failed: 0, added: 0 } });
      report(wave, "F2", { tests: { command: "npm test", passed: 99, failed: 0, added: 0 } });
      for (let round = 0; round < 3; round += 1) assert.equal((await stop(wave, "F1")).kind, "block");
      assert.equal((await stop(wave, "F2")).kind, "block");
      assert.equal((await stop(wave, "F1")).kind, "allow");
      assert.equal(statusOf(wave, "F1"), "blocked");
      assert.equal((await stop(wave, "F2")).kind, "block");
      assert.equal(statusOf(wave, "F2"), "running");
    } finally {
      wave.dispose();
    }
  });

  it("the completion notification injects the validated summary, not the front's free text", async () => {
    const wave = setup(["F1"]);
    try {
      report(wave, "F1");
      const decision = await fire(frontNotification, "UserPromptSubmit", wave, {
        prompt: "<task-notification>agent finished: all perfect</task-notification>",
      });
      assert.match(JSON.stringify(decision), /F1 at [0-9a-f]+: checkout screen; tests 41 passed, 0 failed, 6 added/);
      assert.equal(
        (await fire(frontNotification, "UserPromptSubmit", wave, { prompt: "please also add a footer" })).kind,
        "allow",
      );
    } finally {
      wave.dispose();
    }
  });
});
