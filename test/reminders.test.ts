import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import type { JsonObject } from "../src/core/parsed.js";
import type { HookEvent } from "../src/hooks/events.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { tokenEstimate } from "../src/instructions/types.js";
import { DEFAULT_MAX_RULES, DEFAULT_MAX_TOKENS } from "../src/reminders/select.js";
import { recordViolation } from "../src/rules/violations.js";
import { type MemoryFs, memoryFs } from "./memory-fs.js";
import { cliJson, fakeRuntime, field, parseBody, stdinFrom } from "./support.js";

const PROJECT = toAbsolutePath("/home/ana/project");
const at = (path: string): AbsolutePath => toAbsolutePath(path, PROJECT);

const rule = (id: string, text: string, scope: string): string =>
  [`  - id: ${id}`, `    text: "${text}"`, "    severity: prefer", "    bucket: reminder", `    scope: ${scope}`].join(
    "\n",
  );

const RULES = [
  "rules:",
  rule("api-schema", "Validate API input with the shared schema", '{paths: ["src/api/**"]}'),
  rule("reversible", "Write a down step for every migration", "{words: [migration]}"),
  rule("short", "Keep answers short and concrete", "{}"),
  "",
].join("\n");

const projectFs = (files: Readonly<Record<string, string>> = {}): MemoryFs =>
  memoryFs({
    [at(".git/HEAD")]: "ref: refs/heads/feature\n",
    [at(".finitemonkey/config.yml")]: "lang: en\n",
    [at(".finitemonkey/rules.yml")]: RULES,
    ...Object.fromEntries(Object.entries(files).map(([path, text]) => [at(path), text])),
  });

const fire = async (fs: MemoryFs, event: HookEvent, payload: JsonObject, session = "s1"): Promise<HookOutcome> => {
  const runtime = fakeRuntime({ fs });
  fs.tick(1000);
  return runHook(event, {
    stdin: stdinFrom(JSON.stringify({ hook_event_name: event, session_id: session, cwd: PROJECT, ...payload })),
    deadlineMs: 5000,
    handlers: DEFAULT_HANDLERS,
    cwd: PROJECT,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });
};

const reminderOf = (outcome: HookOutcome): string => {
  if (outcome.stdout.trim() === "") return "";
  const text = field(parseBody(outcome.stdout), "hookSpecificOutput", "additionalContext");
  if (typeof text !== "string") return "";
  const start = text.indexOf("finitemonkey reminders");
  return start < 0 ? "" : text.slice(start);
};

const edit = (path: string): JsonObject => ({
  tool_name: "Edit",
  tool_input: { file_path: at(path), old_string: "a", new_string: "b" },
});

describe("reminders: only on events", () => {
  it("injects nothing on a turn without a matching event", async () => {
    const fs = projectFs();
    assert.equal(reminderOf(await fire(fs, "UserPromptSubmit", { prompt: "rename the pay button" })), "");
    assert.equal(reminderOf(await fire(fs, "PreToolUse", edit("src/ui/button.tsx"))), "");
    assert.equal(reminderOf(await fire(fs, "SessionStart", { source: "clear" })), "");
    assert.equal(reminderOf(await fire(fs, "PostToolUse", edit("src/api/pay.ts"))), "");
  });

  it("injects a rule when its scope matches, once until the next compaction", async () => {
    const fs = projectFs();
    assert.match(reminderOf(await fire(fs, "PreToolUse", edit("src/api/pay.ts"))), /shared schema/);
    assert.equal(reminderOf(await fire(fs, "PreToolUse", edit("src/api/refund.ts"))), "");
    assert.match(
      reminderOf(await fire(fs, "UserPromptSubmit", { prompt: "add a migration for refunds" })),
      /down step/,
    );
    const compacted = reminderOf(await fire(fs, "SessionStart", { source: "compact" }));
    assert.match(compacted, /shared schema/);
    assert.match(compacted, /down step/);
    assert.match(compacted, /short and concrete/);
  });

  it("injects on startup and resume", async () => {
    for (const source of ["startup", "resume"]) {
      assert.match(reminderOf(await fire(projectFs(), "SessionStart", { source })), /short and concrete/);
    }
  });

  it("injects a rule broken in the last task on the next prompt", async () => {
    const fs = projectFs();
    recordViolation(fakeRuntime({ fs }), at(".finitemonkey"), {
      session: "s1",
      rule: "short",
      source: "person",
      detail: "three paragraphs for a yes",
    });
    assert.match(reminderOf(await fire(fs, "UserPromptSubmit", { prompt: "and now the refund page" })), /short/);
    assert.equal(reminderOf(await fire(fs, "UserPromptSubmit", { prompt: "and the receipt" })), "");
  });

  it("only logs in shadow mode", async () => {
    const fs = projectFs({ ".finitemonkey/policy.yml": "guards:\n  reminders: shadow\n" });
    assert.equal(reminderOf(await fire(fs, "SessionStart", { source: "startup" })), "");
    assert.match(fs.read(at(".finitemonkey/log.jsonl")) ?? "", /reminder_shadow/);
  });
});

const forty = (): string =>
  [
    "rules:",
    ...Array.from({ length: 40 }, (_, index) =>
      rule(`r${String(index)}`, `Reminder number ${String(index)} about naming things clearly in this module`, "{}"),
    ),
    "",
  ].join("\n");

describe("reminders: size", () => {
  it(`stays under ${String(DEFAULT_MAX_RULES)} rules and ${String(DEFAULT_MAX_TOKENS)} tokens with 40 reminder rules`, async () => {
    const fs = projectFs({ ".finitemonkey/rules.yml": forty() });
    const text = reminderOf(await fire(fs, "SessionStart", { source: "startup" }));
    const lines = text.split("\n").filter((line) => line.startsWith("- "));
    assert.ok(lines.length > 0 && lines.length <= DEFAULT_MAX_RULES, text);
    assert.ok(tokenEstimate(text) <= DEFAULT_MAX_TOKENS, String(tokenEstimate(text)));
  });

  it("puts the most violated rule last", async () => {
    const fs = projectFs();
    const runtime = fakeRuntime({ fs });
    for (let n = 0; n < 3; n += 1)
      recordViolation(runtime, at(".finitemonkey"), { session: "s0", rule: "api-schema", source: "stop", detail: "" });
    const lines = reminderOf(await fire(fs, "SessionStart", { source: "startup" })).split("\n");
    assert.match(lines.at(-1) ?? "", /shared schema/);
  });
});

describe("reminders: subagents read the rules from disk", () => {
  it("a subagent gets the current text of a rule edited after the parent session started", async () => {
    const fs = projectFs();
    assert.match(reminderOf(await fire(fs, "SessionStart", { source: "startup" })), /short and concrete/);
    fs.writeText(
      at(".finitemonkey/rules.yml"),
      RULES.replace("Keep answers short and concrete", "Answer in two lines"),
    );
    const sub = reminderOf(await fire(fs, "SubagentStart", { agent_id: "a1", agent_type: "Explore" }));
    assert.match(sub, /Answer in two lines/);
    assert.doesNotMatch(sub, /short and concrete/);
  });
});

describe("reminders command", () => {
  it("shows what would be injected now and why", async () => {
    const fs = projectFs();
    const { code, body } = await cliJson(
      ["reminders", "--event", "tool", "--tool", "Edit", "--path", "src/api/pay.ts"],
      {
        runtime: fakeRuntime({ fs }),
        cwd: PROJECT,
      },
    );
    assert.equal(code, 0);
    assert.deepEqual(field(body, "data", "picked"), [{ id: "api-schema", why: "path", violations: 0 }]);
  });
});
