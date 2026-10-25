import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import {
  DEFAULT_HOOK_DEADLINE_MS,
  HOOK_EVENTS,
  HOOK_POLICIES,
  parseDeadline,
  parseHookEvent,
} from "../src/hooks/events.js";
import type { HookHandlers } from "../src/hooks/handlers.js";
import { parseHookPayload } from "../src/hooks/payload.js";
import { type HookRunOptions, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { bundle, cliJson, fakeRuntime, field, parseBody, silentStdin, stdinFrom, type TimerMode } from "./support.js";

const payload = (event: string, extra: Readonly<Record<string, unknown>> = {}): string =>
  JSON.stringify({ session_id: "s1", cwd: "/tmp", hook_event_name: event, ...extra });

const options = (text: string | undefined, handlers: HookHandlers = {}, timer: TimerMode = "real"): HookRunOptions => ({
  stdin: text === undefined ? silentStdin() : stdinFrom(text),
  deadlineMs: 1000,
  handlers,
  cwd: toAbsolutePath("/tmp"),
  t: createTranslator("en"),
  startTimer: fakeRuntime({ timer }).startTimer,
});

const boom = (): never => {
  throw new Error("kaput");
};

describe("hook events", () => {
  const names = [
    ["PreToolUse", "PreToolUse"],
    ["pre-tool-use", "PreToolUse"],
    ["subagent_stop", "SubagentStop"],
    ["SESSIONSTART", "SessionStart"],
    ["nope", undefined],
  ] as const;
  for (const [raw, event] of names) {
    it(`parses "${raw}" as ${String(event)}`, () => {
      assert.equal(parseHookEvent(raw), event);
    });
  }

  it("covers every event the product needs and gates fail closed", () => {
    const required = [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "Stop",
      "SubagentStop",
      "PreCompact",
    ];
    const known: readonly string[] = HOOK_EVENTS;
    for (const event of required) assert.ok(known.includes(event), event);
    const closed = HOOK_EVENTS.filter((event) => HOOK_POLICIES[event].failClosed);
    assert.deepEqual(closed, ["UserPromptSubmit", "PreToolUse", "Stop", "SubagentStop", "ConfigChange"]);
  });

  const deadlines = [
    ["250", 250],
    ["0", DEFAULT_HOOK_DEADLINE_MS],
    ["abc", DEFAULT_HOOK_DEADLINE_MS],
    [undefined, DEFAULT_HOOK_DEADLINE_MS],
  ] as const;
  for (const [raw, ms] of deadlines) {
    it(`deadline "${String(raw)}" is ${String(ms)} ms`, () => {
      assert.equal(parseDeadline(raw), ms);
    });
  }
});

describe("hook payload validator", () => {
  const cases = [
    { text: payload("PreToolUse"), interactive: false, ok: true },
    { text: "", interactive: true, ok: true },
    { text: "", interactive: false, ok: false },
    { text: "not json", interactive: false, ok: false },
    { text: "[1]", interactive: false, ok: false },
    { text: payload("Stop"), interactive: false, ok: false },
  ] as const;
  for (const { text, interactive, ok } of cases) {
    it(`${JSON.stringify(text)} (interactive ${String(interactive)}) is ${ok ? "accepted" : "rejected"}`, () => {
      assert.equal(parseHookPayload("PreToolUse", text, interactive).ok, ok);
    });
  }

  it("extracts typed fields", () => {
    const parsed = parseHookPayload("PreToolUse", payload("PreToolUse", { session_id: 42 }), false);
    assert.ok(parsed.ok);
    assert.equal(parsed.value.hookEventName, "PreToolUse");
    assert.equal(parsed.value.sessionId, undefined);
    assert.equal(parsed.value.cwd, "/tmp");
  });
});

describe("hook runner", () => {
  it("no-op answers a JSON object on stdout and exits 0", async () => {
    const outcome = await runHook("PreToolUse", options(payload("PreToolUse", { tool_name: "Bash" })));
    assert.deepEqual(outcome, { exitCode: 0, stdout: '{"continue":true}\n', stderr: "", verdict: "allow" });
  });

  it("merges handler output", async () => {
    const handlers: HookHandlers = { SessionStart: [() => ({ kind: "allow", output: { suppressOutput: true } })] };
    const outcome = await runHook("SessionStart", options(payload("SessionStart"), handlers));
    assert.deepEqual(parseBody(outcome.stdout), { continue: true, suppressOutput: true });
  });

  it("blocks with exit 2 and the reason on stderr", async () => {
    const handlers: HookHandlers = { Stop: [() => ({ kind: "block", reason: "gate failed" })] };
    const outcome = await runHook("Stop", options(payload("Stop"), handlers));
    assert.deepEqual(outcome, { exitCode: 2, stdout: "", stderr: "finitemonkey: gate failed\n", verdict: "block" });
  });

  const failures = [
    { event: "PreToolUse", cause: "handler throws", text: payload("PreToolUse"), timer: "never", exit: 2 },
    { event: "PostToolUse", cause: "handler throws", text: payload("PostToolUse"), timer: "never", exit: 0 },
    { event: "Stop", cause: "deadline passes", text: undefined, timer: "fires-now", exit: 2 },
    { event: "SessionStart", cause: "deadline passes", text: undefined, timer: "fires-now", exit: 0 },
    { event: "UserPromptSubmit", cause: "stdin is garbage", text: "{oops", timer: "never", exit: 2 },
  ] as const;
  for (const { event, cause, text, timer, exit } of failures) {
    it(`${event} fails ${exit === 2 ? "closed" : "open"} when the ${cause}`, async () => {
      const handlers: HookHandlers = { [event]: [boom] };
      const outcome = await runHook(event, options(text, handlers, timer));
      assert.equal(outcome.exitCode, exit);
      assert.equal(outcome.verdict, exit === 2 ? "failed_closed" : "failed_open");
      assert.match(outcome.stderr, /finitemonkey doctor/);
    });
  }

  it("a real timer stops a hook whose stdin never closes", async () => {
    const outcome = await runHook("PreToolUse", { ...options(undefined), deadlineMs: 30 });
    assert.equal(outcome.exitCode, 2);
    assert.match(outcome.stderr, /deadline of 30 ms/);
  });
});

describe("finitemonkey hook", () => {
  it("bundle reads stdin JSON and writes hook JSON", () => {
    const result = bundle(["hook", "pre-tool-use"], payload("PreToolUse", { tool_name: "Bash" }));
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(parseBody(result.stdout), { continue: true });
  });

  it("bundle blocks a gate when stdin is garbage, in the user's language", () => {
    const result = bundle(["hook", "Stop"], "{oops", { LANG: "pt_BR.UTF-8" });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /bloqueou por seguran/);
  });

  it("ignores --json and keeps the hook protocol", async () => {
    const result = await cliJson(["hook", "PostToolUse"], { stdin: stdinFrom(payload("PostToolUse")) });
    assert.equal(result.code, 0);
    assert.equal(field(result.body, "continue"), true);
  });
});
