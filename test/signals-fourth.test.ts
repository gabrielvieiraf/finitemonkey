import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { JsonObject } from "../src/core/parsed.js";
import type { HookEvent } from "../src/hooks/events.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { fourthOutcomes } from "../src/signals/attempts.js";
import { readEntries, signalFiles } from "../src/signals/store.js";
import { writesFiles } from "../src/signals/writes.js";
import { fmPaths } from "../src/task/paths.js";
import { type MemoryFs, memoryFs } from "./memory-fs.js";
import { cliJson, fakeRuntime, field, parseBody, stdinFrom } from "./support.js";

const PROJECT = toAbsolutePath("/home/ana/project");
const FILE = join(PROJECT, "src", "checkout.ts");

const projectFs = (policy?: string): MemoryFs =>
  memoryFs({
    [toAbsolutePath(join(PROJECT, ".git", "HEAD"))]: "ref: refs/heads/main\n",
    [toAbsolutePath(join(PROJECT, ".finitemonkey", "config.yml"))]: "lang: en\n",
    ...(policy === undefined ? {} : { [toAbsolutePath(join(PROJECT, ".finitemonkey", "policy.yml"))]: policy }),
  });

const fire = async (fs: MemoryFs, event: HookEvent, payload: JsonObject): Promise<HookOutcome> => {
  const runtime = fakeRuntime({ fs });
  fs.tick(1000);
  return runHook(event, {
    stdin: stdinFrom(JSON.stringify({ hook_event_name: event, session_id: "s1", cwd: PROJECT, ...payload })),
    deadlineMs: 5000,
    handlers: DEFAULT_HANDLERS,
    cwd: PROJECT,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });
};

const failure = (ms: number): JsonObject => ({
  tool_name: "Bash",
  tool_input: { command: "npm test" },
  error: `FAIL test/checkout.test.ts > total in cents (${String(ms)} ms)\nAssertionError: expected 1200 to be 1000`,
});

const threeFailures = async (fs: MemoryFs): Promise<void> => {
  await fire(fs, "UserPromptSubmit", { prompt: "Fix the checkout total" });
  for (const ms of [12, 9, 11]) {
    await fire(fs, "PostToolUse", {
      tool_name: "Edit",
      tool_input: { file_path: FILE, old_string: "a", new_string: `b${String(ms)}` },
      tool_response: { success: true },
    });
    await fire(fs, "PostToolUseFailure", failure(ms));
  }
};

const edit: JsonObject = { tool_name: "Edit", tool_input: { file_path: FILE, old_string: "a", new_string: "c" } };

const denied = (outcome: HookOutcome): string => {
  if (outcome.stdout.trim() === "") return "";
  const body = parseBody(outcome.stdout);
  const decision = field(body, "hookSpecificOutput", "permissionDecision");
  const reason = field(body, "hookSpecificOutput", "permissionDecisionReason");
  return decision === "deny" && typeof reason === "string" ? reason : "";
};

const context = (outcome: HookOutcome): string => {
  if (outcome.stdout.trim() === "") return "";
  const text = field(parseBody(outcome.stdout), "hookSpecificOutput", "additionalContext");
  return typeof text === "string" ? text : "";
};

const ACTIVE = "guards:\n  fourth-attempt: active\n";

describe("fourth-attempt guard: what counts as a write", () => {
  it("Edit, Write, NotebookEdit, sed -i, perl -pi, redirects and PowerShell writers count; reads and tests do not", () => {
    const bash = (command: string): boolean => writesFiles({ tool_name: "Bash", tool_input: { command } });
    const pwsh = (command: string): boolean => writesFiles({ tool_name: "PowerShell", tool_input: { command } });
    assert.ok(writesFiles({ tool_name: "Write", tool_input: { file_path: FILE, content: "" } }));
    assert.ok(writesFiles({ tool_name: "NotebookEdit", tool_input: { notebook_path: "a.ipynb" } }));
    assert.ok(bash("sed -i 's/1000/1200/' src/checkout.ts"));
    assert.ok(bash("perl -pi -e 's/a/b/' src/checkout.ts"));
    assert.ok(bash("echo 'export const x = 1' > src/checkout.ts"));
    assert.ok(bash("cat patch.txt >> src/checkout.ts"));
    assert.ok(pwsh("Set-Content -Path src/checkout.ts -Value 'x'"));
    assert.ok(pwsh("'x' | Out-File src/checkout.ts"));
    assert.ok(pwsh("echo x > src/checkout.ts"));
    assert.ok(!bash("npm test 2>/dev/null"));
    assert.ok(!bash("grep -n total src/checkout.ts"));
    assert.ok(!pwsh("Get-Content src/checkout.ts"));
    assert.ok(!writesFiles({ tool_name: "Read", tool_input: { file_path: FILE } }));
  });
});

describe("fourth-attempt guard: active mode blocks", () => {
  it("blocks the fourth correction through Edit, sed -i, a redirect and PowerShell, and lets tests run", async () => {
    const fs = projectFs(ACTIVE);
    await threeFailures(fs);
    const attempts: readonly JsonObject[] = [
      edit,
      { tool_name: "Bash", tool_input: { command: "sed -i 's/1000/1200/' src/checkout.ts" } },
      { tool_name: "Bash", tool_input: { command: "printf 'x' > src/checkout.ts" } },
      { tool_name: "PowerShell", tool_input: { command: "Set-Content src/checkout.ts 'x'" } },
    ];
    for (const attempt of attempts) {
      const outcome = await fire(fs, "PreToolUse", attempt);
      assert.match(denied(outcome), /fourth correction on error signature [0-9a-f]{4} after 3 failed attempts/);
      assert.match(denied(outcome), /researcher agent/);
    }
    assert.equal(denied(await fire(fs, "PreToolUse", { tool_name: "Bash", tool_input: { command: "npm test" } })), "");
  });

  it("two failures are not enough", async () => {
    const fs = projectFs(ACTIVE);
    await fire(fs, "PostToolUseFailure", failure(1));
    await fire(fs, "PostToolUseFailure", failure(2));
    assert.equal(denied(await fire(fs, "PreToolUse", edit)), "");
  });

  it("research through the researcher agent clears the block", async () => {
    const fs = projectFs(ACTIVE);
    await threeFailures(fs);
    assert.notEqual(denied(await fire(fs, "PreToolUse", edit)), "");
    await fire(fs, "PostToolUse", {
      tool_name: "Agent",
      tool_input: { subagent_type: "general-purpose", prompt: "look around" },
      tool_response: {},
    });
    assert.notEqual(denied(await fire(fs, "PreToolUse", edit)), "");
    await fire(fs, "PostToolUse", {
      tool_name: "Agent",
      tool_input: { subagent_type: "finitemonkey:researcher", prompt: "AssertionError in total in cents" },
      tool_response: {},
    });
    assert.equal(denied(await fire(fs, "PreToolUse", edit)), "");
  });

  it("a researcher SubagentStop also clears it", async () => {
    const fs = projectFs(ACTIVE);
    await threeFailures(fs);
    await fire(fs, "SubagentStop", { agent_id: "r1", agent_type: "researcher", stop_hook_active: false });
    assert.equal(denied(await fire(fs, "PreToolUse", edit)), "");
  });

  it("finitemonkey signals release lets the next correction through and is recorded", async () => {
    const fs = projectFs(ACTIVE);
    await threeFailures(fs);
    const reason = denied(await fire(fs, "PreToolUse", edit));
    const sig = /signature ([0-9a-f]{4})/.exec(reason)?.[1] ?? "";
    const runtime = fakeRuntime({ fs });
    const refused = await cliJson(["signals", "release", sig], { cwd: PROJECT, runtime });
    assert.notEqual(refused.code, 0);
    const stdin = Object.assign(stdinFrom(""), { isTTY: true });
    const released = await cliJson(["signals", "release", sig], { cwd: PROJECT, runtime, stdin });
    assert.equal(released.code, 0, released.stdout);
    assert.equal(denied(await fire(fs, "PreToolUse", edit)), "");
    const log = fs.read(toAbsolutePath(join(PROJECT, ".finitemonkey", "log.jsonl"))) ?? "";
    assert.match(log, new RegExp(`"event":"signals.release","sig":"${sig}"`));
  });
});

describe("fourth-attempt guard: the mode comes from policy.yml", () => {
  it("without a mode in policy.yml it warns, records the shadow firing and lets the write through", async () => {
    const fs = projectFs("level: standard\n");
    await threeFailures(fs);
    const outcome = await fire(fs, "PreToolUse", edit);
    assert.equal(denied(outcome), "");
    assert.match(context(outcome), /fourth correction on error signature [0-9a-f]{4}/);
    const shadow = parseBody(fs.read(toAbsolutePath(join(PROJECT, ".finitemonkey", "cache", "shadow.json"))) ?? "{}");
    assert.equal(field(shadow, "fourth-attempt", "firings"), 1);
    assert.equal(context(await fire(fs, "PreToolUse", edit)), "");
  });

  it("without policy.yml it also starts as a warning", async () => {
    const fs = projectFs();
    await threeFailures(fs);
    const outcome = await fire(fs, "PreToolUse", edit);
    assert.equal(denied(outcome), "");
    assert.match(context(outcome), /fourth correction/);
  });

  it("off in policy.yml does nothing", async () => {
    const fs = projectFs("guards:\n  fourth-attempt: off\n");
    await threeFailures(fs);
    const outcome = await fire(fs, "PreToolUse", edit);
    assert.equal(denied(outcome), "");
    assert.equal(context(outcome), "");
  });

  it("counts how often the warned fourth attempt solved the error", async () => {
    const fs = projectFs("level: standard\n");
    await threeFailures(fs);
    await fire(fs, "PreToolUse", edit);
    await fire(fs, "UserPromptSubmit", { prompt: "Looks good, now add the receipt email" });
    const entries = readEntries(fakeRuntime({ fs }), signalFiles(fmPaths(PROJECT)));
    assert.deepEqual(fourthOutcomes(entries), { fired: 1, solved: 1 });
    const shown = await cliJson(["signals"], { cwd: PROJECT, runtime: fakeRuntime({ fs }) });
    assert.deepEqual(field(shown.body, "data", "fourth"), { fired: 1, solved: 1 });
  });
});
