import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import type { JsonObject } from "../src/core/parsed.js";
import { frontsPostToolUse, frontsPreToolUse, frontsSubagentStart } from "../src/fronts/hooks.js";
import { parseWavePlan } from "../src/fronts/plan-input.js";
import { REFUSALS, refusals } from "../src/fronts/rules.js";
import { type Front, type FrontsState, readFronts, serializeState } from "../src/fronts/state.js";
import { statusSegment } from "../src/fronts/status.js";
import type { HookEvent } from "../src/hooks/events.js";
import type { HookHandler } from "../src/hooks/handlers.js";
import { git, runtime, t, tempRepo, write } from "./git-support.js";
import { field, parseBody, ROOT } from "./support.js";
import { BUNDLE } from "./support.js";

const FIXTURES = join(ROOT, "test", "fixtures", "fronts");

const FILES = [
  ...["a", "b", "c", "d"].map((name) => `src/checkout/${name}.ts`),
  ...["a", "b", "c"].map((name) => `src/invites/${name}.ts`),
  ...["a", "b", "c"].map((name) => `src/report/${name}.ts`),
  "src/tiny/one.ts",
  "src/routes.ts",
];

const planOf = (name: string) => {
  const parsed = parseWavePlan(readFileSync(join(FIXTURES, name), "utf8"));
  assert.ok(parsed.ok);
  return parsed.value;
};

describe("fronts plan refusal rules", () => {
  it("the valid wave passes every rule", () => {
    assert.deepEqual(refusals(planOf("valid.yml"), FILES), []);
  });

  for (const rule of REFUSALS) {
    it(`fixture ${rule}.yml is refused by ${rule}`, () => {
      const found = refusals(planOf(`${rule}.yml`), FILES).map((item) => item.rule);
      assert.ok(found.includes(rule), `${rule}: ${found.join(", ")}`);
    });
  }

  it("every rule has a fixture", () => {
    const fixtures = readdirSync(FIXTURES).map((name) => name.replace(/\.yml$/, ""));
    for (const rule of REFUSALS) assert.ok(fixtures.includes(rule), rule);
  });
});

const front = (id: string, status: Front["status"], agentId: string | null = null): Front => ({
  id,
  goal: id,
  contract: null,
  paths: [`src/${id}/**`],
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
  status,
  blockedBy: [],
  inbox: [],
  lastReport: null,
  costUsd: 0,
  startedAt: null,
});

const wave = (fronts: readonly Front[], pending: readonly string[] = []): FrontsState => ({
  wave: 1,
  base: "main@abc1234",
  briefing: ".finitemonkey/briefing.md",
  maxConcurrent: 3,
  budgetUsd: null,
  budgetMinutes: null,
  fronts,
  pending,
});

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

const agent = (prompt: string, type = "general-purpose"): JsonObject => ({
  tool_name: "Agent",
  tool_input: { prompt, description: "front", subagent_type: type },
});

describe("fronts hooks", () => {
  it("blocks a new write front above max_concurrent and lets read-only agents through", async () => {
    const repo = tempRepo();
    try {
      write(
        repo.root,
        ".finitemonkey/fronts.yml",
        serializeState(
          wave([front("F1", "running"), front("F2", "running"), front("F3", "running"), front("F4", "planned")]),
        ),
      );
      assert.equal(
        (await fire(frontsPreToolUse, "PreToolUse", repo.root, agent("Read the briefing. Front: F4"))).kind,
        "block",
      );
      assert.equal(
        (await fire(frontsPreToolUse, "PreToolUse", repo.root, agent("look around", "Explore"))).kind,
        "allow",
      );
      const workflow = await fire(frontsPreToolUse, "PreToolUse", repo.root, { tool_name: "Workflow", tool_input: {} });
      assert.match(JSON.stringify(workflow), /"permissionDecision":"ask"/);
      write(
        repo.root,
        ".finitemonkey/fronts.yml",
        serializeState(wave([front("F1", "running"), front("F4", "planned")])),
      );
      assert.equal((await fire(frontsPreToolUse, "PreToolUse", repo.root, agent("Front: F4"))).kind, "allow");
    } finally {
      repo.dispose();
    }
  });

  it("a launched front becomes running and gets its agent id at SubagentStart", async () => {
    const repo = tempRepo();
    try {
      write(
        repo.root,
        ".finitemonkey/fronts.yml",
        serializeState(wave([front("F1-checkout", "planned"), front("F2-invites", "planned")])),
      );
      await fire(
        frontsPostToolUse,
        "PostToolUse",
        repo.root,
        agent("Read .finitemonkey/briefing.md\nFront: F2-invites\nGoal: invites"),
      );
      await fire(frontsSubagentStart, "SubagentStart", repo.root, {
        agent_id: "agent-42",
        agent_type: "general-purpose",
      });
      const state = readFronts(runtime, repo.root);
      assert.ok(state.ok);
      const invites = state.value.fronts.find((item) => item.id === "F2-invites");
      assert.ok(invites);
      assert.equal(invites.status, "running");
      assert.equal(invites.agentId, "agent-42");
      assert.deepEqual(state.value.pending, []);
      assert.equal(statusSegment(state.value), "fronts 1/3");
    } finally {
      repo.dispose();
    }
  });
});

describe("fronts plan and status commands", () => {
  it("plan --apply creates a worktree per front and status prints one screen", () => {
    const repo = tempRepo(Object.fromEntries(FILES.map((path) => [path, "export {};\n"])));
    const fm = (...args: readonly string[]) => {
      const result = spawnSync(process.execPath, [BUNDLE, ...args, "--json"], {
        cwd: repo.root,
        encoding: "utf8",
        env: {
          PATH: process.env["PATH"],
          SystemRoot: process.env["SystemRoot"],
          HOME: repo.root,
          USERPROFILE: repo.root,
        },
        timeout: 60000,
      });
      return { code: result.status, body: parseBody(result.stdout) };
    };
    try {
      write(repo.root, "wave.yml", readFileSync(join(FIXTURES, "valid.yml"), "utf8"));
      const refused = fm("fronts", "plan", join(FIXTURES, "overlapping-paths.yml"));
      assert.equal(refused.code, 1);
      assert.equal(field(refused.body, "error", "code"), "fronts_refused");
      const applied = fm("fronts", "plan", "wave.yml", "--apply");
      assert.equal(applied.code, 0, JSON.stringify(applied.body));
      assert.match(git(repo.root, "worktree", "list"), /front\/F1-checkout/);
      const status = fm("fronts", "status");
      const rows = field(status.body, "data", "rows");
      assert.ok(Array.isArray(rows));
      assert.equal(rows.length, 3);
      assert.deepEqual(field(status.body, "data", "next"), [
        "launch F1-checkout",
        "launch F2-invites",
        "release F3-report when F1-checkout merge",
      ]);
      for (const id of ["F1-checkout", "F2-invites", "F3-report"]) {
        spawnSync("git", ["worktree", "unlock", toAbsolutePath(join(repo.root, ".claude", "worktrees", id))], {
          cwd: repo.root,
        });
      }
    } finally {
      repo.dispose();
    }
  });
});
