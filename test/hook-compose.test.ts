import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { Runtime } from "../src/core/runtime.js";
import { gitPreToolUse } from "../src/git/hooks/pre-tool.js";
import { configDigest } from "../src/guards/tests/analyze.js";
import {
  composeDecisions,
  DEFAULT_HANDLERS,
  type HookHandler,
  type HookInput,
  mergeHandlers,
  mergeOutputs,
} from "../src/hooks/handlers.js";
import { EMPTY_PAYLOAD } from "../src/hooks/payload.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { proseMarkerGuard } from "../src/prose/marker-guard.js";
import { proseCommandGuard } from "../src/prose/text-guard.js";
import { secretsPreToolUse } from "../src/secrets/guards/pre-tool.js";
import { fakeRuntime, field, parseBody, stdinFrom } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const t = createTranslator("en");

const input = (runtime: Runtime = fakeRuntime()): HookInput => ({
  event: "PreToolUse",
  payload: EMPTY_PAYLOAD,
  cwd: toAbsolutePath(ROOT),
  runtime,
  t,
  env: {},
});

const hook = (event: Parameters<typeof runHook>[0], payload: Readonly<Record<string, unknown>>, runtime: Runtime) =>
  runHook(event, {
    stdin: stdinFrom(JSON.stringify({ session_id: "s1", cwd: ROOT, hook_event_name: event, ...payload })),
    deadlineMs: 5000,
    handlers: DEFAULT_HANDLERS,
    cwd: toAbsolutePath(ROOT),
    t,
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });

describe("guard composition", () => {
  it("merges system messages, additional context and keeps the strictest permission", () => {
    const merged = mergeOutputs(
      {
        systemMessage: "a",
        hookSpecificOutput: {
          hookEventName: "X",
          additionalContext: "one",
          permissionDecision: "deny",
          permissionDecisionReason: "no",
        },
      },
      {
        systemMessage: "b",
        suppressOutput: true,
        hookSpecificOutput: { hookEventName: "X", additionalContext: "two", permissionDecision: "allow" },
      },
    );
    assert.deepEqual(merged, {
      systemMessage: "a\nb",
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: "X",
        additionalContext: "one\ntwo",
        permissionDecision: "deny",
        permissionDecisionReason: "no",
      },
    });
  });

  it("the first block wins and later guards do not run", async () => {
    const ran: string[] = [];
    const guard =
      (name: string, block: boolean): HookHandler =>
      () => {
        ran.push(name);
        return block ? { kind: "block", reason: name } : { kind: "allow", output: { systemMessage: name } };
      };
    const decision = await composeDecisions(input(), [guard("a", false), guard("b", true), guard("c", true)]);
    assert.deepEqual(decision, { kind: "block", reason: "b" });
    assert.deepEqual(ran, ["a", "b"]);
  });

  it("allow outputs from every guard are merged", async () => {
    const decision = await composeDecisions(input(), [
      () => ({ kind: "allow", output: { systemMessage: "x" } }),
      () => ({ kind: "allow" }),
      () => ({ kind: "allow", output: { systemMessage: "y" } }),
    ]);
    assert.deepEqual(decision, { kind: "allow", output: { systemMessage: "x\ny" } });
  });

  it("other fronts append guards to the same event in order", () => {
    const one: HookHandler = () => ({ kind: "allow" });
    const two: HookHandler = () => ({ kind: "allow" });
    const merged = mergeHandlers({ PreToolUse: [one] }, { PreToolUse: [two], Stop: [one] });
    assert.deepEqual(merged.PreToolUse, [one, two]);
    assert.deepEqual(merged.Stop, [one]);
    assert.ok((DEFAULT_HANDLERS.PreToolUse?.length ?? 0) >= 3);
  });

  it("secrets, prose and git guards all run on PreToolUse, in that order", () => {
    const list = DEFAULT_HANDLERS.PreToolUse ?? [];
    const order = [secretsPreToolUse, proseMarkerGuard, proseCommandGuard, gitPreToolUse].map((guard) =>
      list.indexOf(guard),
    );
    assert.ok(
      order.every((index) => index >= 0),
      JSON.stringify(order),
    );
    assert.deepEqual(
      order,
      [...order].sort((left, right) => left - right),
    );
  });
});

describe("guards through the PreToolUse hook", () => {
  const testFile = `${ROOT}/src/cart.test.ts`;
  const source = 'it("a", () => { expect(1).toBe(1); });\n';

  const cases = [
    {
      name: "Edit adding .skip to a test",
      tool: "Edit",
      args: { file_path: testFile, old_string: 'it("a"', new_string: 'it.skip("a"' },
      deny: /skip, only or todo/,
    },
    { name: "Write emptying a test", tool: "Write", args: { file_path: testFile, content: "" }, deny: /test removed/ },
    {
      name: "Edit keeping the test",
      tool: "Edit",
      args: { file_path: testFile, old_string: "toBe(1)", new_string: "toBe(1) " },
      deny: undefined,
    },
    {
      name: "Edit on lint config",
      tool: "Edit",
      args: { file_path: `${ROOT}/eslint.config.mjs`, old_string: "a", new_string: "b" },
      deny: /config changed/,
    },
    {
      name: "sed -i on a test",
      tool: "Bash",
      args: { command: "sed -i 's/it(/it.skip(/' src/cart.test.ts" },
      deny: /shell command writes/,
    },
    {
      name: "git commit --no-verify",
      tool: "Bash",
      args: { command: "git commit --no-verify -m x" },
      deny: /skips the git hooks/,
    },
    {
      name: "Write to the evidence ledger",
      tool: "Write",
      args: { file_path: `${ROOT}/.finitemonkey/evidence/t.jsonl`, content: "{}" },
      deny: /written only by the finitemonkey/,
    },
    {
      name: "plain source edit",
      tool: "Write",
      args: { file_path: `${ROOT}/src/cart.ts`, content: "export {}" },
      deny: undefined,
    },
  ] as const;
  for (const { name, tool, args, deny } of cases) {
    it(`${deny === undefined ? "allows" : "denies"} ${name}`, async () => {
      const runtime = fakeRuntime({ files: { [testFile]: source, [`${ROOT}/eslint.config.mjs`]: "a" } });
      const outcome = await hook("PreToolUse", { tool_name: tool, tool_input: args }, runtime);
      assert.equal(outcome.exitCode, 0);
      const body = parseBody(outcome.stdout);
      const reason = field(body, "hookSpecificOutput", "permissionDecisionReason");
      if (deny === undefined) {
        assert.equal(outcome.verdict, "allow");
        return;
      }
      assert.equal(outcome.verdict, "block");
      assert.equal(field(body, "hookSpecificOutput", "permissionDecision"), "deny");
      assert.match(String(reason), deny);
      assert.doesNotMatch(String(reason), /allow|finitemonkey:/);
      assert.match(String(field(body, "systemMessage")), /finitemonkey: allow|out of reach/);
    });
  }

  const grantFile = `${ROOT}/.finitemonkey/allow/grants.json`;
  const grants = (guard: string, expiresAt: string): string =>
    JSON.stringify({
      grants: [{ guard, reason: "fixture", grantedAt: "2026-10-25T11:50:00.000Z", expiresAt, sessionId: "s1" }],
    });

  it("a live grant typed by the person releases the tests guard", async () => {
    const runtime = fakeRuntime({
      files: { [testFile]: source, [grantFile]: grants("tests", "2026-10-25T12:20:00.000Z") },
    });
    const outcome = await hook(
      "PreToolUse",
      { tool_name: "Write", tool_input: { file_path: testFile, content: "" } },
      runtime,
    );
    assert.equal(outcome.verdict, "allow");
  });

  it("an expired grant does not release anything", async () => {
    const runtime = fakeRuntime({
      files: { [testFile]: source, [grantFile]: grants("tests", "2026-10-25T11:59:00.000Z") },
    });
    const outcome = await hook(
      "PreToolUse",
      { tool_name: "Write", tool_input: { file_path: testFile, content: "" } },
      runtime,
    );
    assert.equal(outcome.verdict, "block");
  });

  it("a config change accepted by hash in the lock passes", async () => {
    const lock = JSON.stringify({ configs: { "eslint.config.mjs": configDigest("eslint.config.mjs", "b") } });
    const runtime = fakeRuntime({
      files: { [`${ROOT}/eslint.config.mjs`]: "a", [`${ROOT}/.finitemonkey/trust.json`]: lock },
    });
    const outcome = await hook(
      "PreToolUse",
      { tool_name: "Write", tool_input: { file_path: `${ROOT}/eslint.config.mjs`, content: "b" } },
      runtime,
    );
    assert.equal(outcome.verdict, "allow");
  });

  it("the allow store is never writable, even with a self grant", async () => {
    const runtime = fakeRuntime({ files: { [grantFile]: grants("self", "2026-10-25T12:20:00.000Z") } });
    const outcome = await hook(
      "PreToolUse",
      { tool_name: "Write", tool_input: { file_path: grantFile, content: "{}" } },
      runtime,
    );
    assert.equal(outcome.verdict, "block");
  });
});

describe("persistent blocks", () => {
  const handlers = (persistent: boolean) => ({
    Stop: [
      (): ReturnType<HookHandler> => ({
        kind: "block",
        reason: "r",
        persistent,
        output: { decision: "block", reason: "r" },
      }),
    ],
  });

  for (const persistent of [true, false]) {
    it(`${persistent ? "keeps" : "drops"} the block when stop_hook_active is set`, async () => {
      const runtime = fakeRuntime();
      const outcome = await runHook("Stop", {
        stdin: stdinFrom(JSON.stringify({ hook_event_name: "Stop", stop_hook_active: true })),
        deadlineMs: 1000,
        handlers: handlers(persistent),
        cwd: toAbsolutePath(ROOT),
        t,
        startTimer: runtime.startTimer,
        runtime,
        env: {},
      });
      assert.equal(outcome.verdict, persistent ? "block" : "stop_released");
      if (persistent) assert.deepEqual(parseBody(outcome.stdout), { decision: "block", reason: "r" });
    });
  }
});
