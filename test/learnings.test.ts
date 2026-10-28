import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import type { JsonObject } from "../src/core/parsed.js";
import type { HookEvent } from "../src/hooks/events.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { tokenEstimate } from "../src/instructions/types.js";
import { DEFAULT_MAX_LESSONS, DEFAULT_MAX_TOKENS } from "../src/learnings/match.js";
import { type Lesson, readLessons } from "../src/learnings/store.js";
import { errorSignature } from "../src/signals/signature.js";
import { DEFAULT_NOW, type MemoryFs, memoryFs } from "./memory-fs.js";
import { cliJson, fakeRuntime, field, parseBody, stdinFrom } from "./support.js";

const PROJECT = toAbsolutePath("/home/ana/project");
const at = (path: string): AbsolutePath => toAbsolutePath(path, PROJECT);
const FM = at(".finitemonkey");
const ERROR = "FAIL test/pay.test.ts > charges\nTypeError: cannot read properties of undefined (reading 'amount')";
const SIG = errorSignature(ERROR)?.sig ?? "";

const lesson = (overrides: Partial<Lesson>): Lesson => ({
  id: "l1",
  text: "The amount comes from the cart, never from the request body.",
  paths: [],
  sig: undefined,
  source: "person",
  createdAt: DEFAULT_NOW,
  lastMatchedAt: undefined,
  uses: 0,
  unhelpful: 0,
  ...overrides,
});

const projectFs = (lessons: readonly Lesson[] = [], files: Readonly<Record<string, string>> = {}): MemoryFs =>
  memoryFs({
    [at(".git/HEAD")]: "ref: refs/heads/feature\n",
    [at(".finitemonkey/config.yml")]: "lang: en\n",
    [at(".finitemonkey/policy.yml")]:
      "guards:\n  quality: active\n  slop: active\n  tests-hold: active\n  regression: active\n  advisor: active\n  reminders: active\n  learnings: active\n  rules-stop: active\n",
    ...(lessons.length === 0
      ? {}
      : { [at(".finitemonkey/learnings.jsonl")]: lessons.map((item) => `${JSON.stringify(item)}\n`).join("") }),
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

const lessonsOf = (outcome: HookOutcome): string => {
  if (outcome.stdout.trim() === "") return "";
  const text = field(parseBody(outcome.stdout), "hookSpecificOutput", "additionalContext");
  if (typeof text !== "string") return "";
  const start = text.indexOf("finitemonkey lessons");
  return start < 0 ? "" : (text.slice(start).split("\n\n")[0] ?? "");
};

const edit = (path: string): JsonObject => ({
  tool_name: "Edit",
  tool_input: { file_path: at(path), old_string: "a", new_string: "b" },
});
const failure = (error: string): JsonObject => ({ tool_name: "Bash", tool_input: { command: "npm test" }, error });

describe("learnings: injected only on a key match", () => {
  const LESSONS = [
    lesson({ id: "path", paths: ["src/api/**"] }),
    lesson({ id: "sig", sig: SIG, text: "Mock the cart before the payment test." }),
  ];

  it("injects nothing without a matching path or error signature", async () => {
    const fs = projectFs(LESSONS);
    assert.equal(lessonsOf(await fire(fs, "PreToolUse", edit("src/ui/button.tsx"))), "");
    assert.equal(
      lessonsOf(await fire(fs, "PreToolUse", { tool_name: "Bash", tool_input: { command: "ls src/api" } })),
      "",
    );
    assert.equal(lessonsOf(await fire(fs, "PostToolUseFailure", failure("Error: port 3000 already in use"))), "");
    assert.equal(lessonsOf(await fire(fs, "UserPromptSubmit", { prompt: "fix the api amount" })), "");
  });

  it("injects a path lesson once per session when a matching file is edited", async () => {
    const fs = projectFs(LESSONS);
    assert.match(lessonsOf(await fire(fs, "PreToolUse", edit("src/api/pay.ts"))), /from the cart/);
    assert.equal(lessonsOf(await fire(fs, "PreToolUse", edit("src/api/refund.ts"))), "");
    assert.match(lessonsOf(await fire(fs, "PreToolUse", edit("src/api/charge.ts"), "s2")), /from the cart/);
    const used = readLessons(fakeRuntime({ fs }), FM).find((item) => item.id === "path");
    assert.equal(used?.uses, 2);
  });

  it("brings the lesson back every time the same error signature returns", async () => {
    const fs = projectFs(LESSONS);
    for (let n = 0; n < 2; n += 1)
      assert.match(lessonsOf(await fire(fs, "PostToolUseFailure", failure(ERROR))), /Mock the cart/);
  });

  it(`injects at most ${String(DEFAULT_MAX_LESSONS)} lessons within about ${String(DEFAULT_MAX_TOKENS)} tokens`, async () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      lesson({
        id: `m${String(index)}`,
        paths: ["src/**"],
        text: `Lesson ${String(index)} about the payment module and its cart rules.`,
      }),
    );
    const text = lessonsOf(await fire(projectFs(many), "PreToolUse", edit("src/api/pay.ts")));
    const lines = text.split("\n").filter((line) => line.startsWith("- "));
    assert.equal(lines.length, DEFAULT_MAX_LESSONS);
    assert.ok(tokenEstimate(text) <= DEFAULT_MAX_TOKENS);
  });

  it("only logs in shadow mode", async () => {
    const fs = projectFs(LESSONS, { ".finitemonkey/policy.yml": "guards:\n  learnings: shadow\n" });
    assert.equal(lessonsOf(await fire(fs, "PreToolUse", edit("src/api/pay.ts"))), "");
    assert.match(fs.read(at(".finitemonkey/log.jsonl")) ?? "", /learning_shadow/);
  });
});

describe("learnings: from an error that stopped after a change", () => {
  it("records a lesson keyed by the signature and the changed file, and brings it back later", async () => {
    const fs = projectFs();
    await fire(fs, "PostToolUseFailure", failure(ERROR));
    await fire(fs, "PostToolUseFailure", failure(ERROR));
    await fire(fs, "PostToolUse", { ...edit("src/cart.ts"), tool_response: { success: true } });
    await fire(fs, "PostToolUse", {
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      tool_response: { exitCode: 1, stdout: "Error: lint failed" },
    });
    await fire(fs, "Stop", { stop_hook_active: false });
    const learned = readLessons(fakeRuntime({ fs }), FM);
    assert.deepEqual(
      learned.map((item) => [item.sig, item.paths]),
      [[SIG, ["src/cart.ts"]]],
    );
    assert.match(lessonsOf(await fire(fs, "PostToolUseFailure", failure(ERROR), "s2")), /src\/cart\.ts/);
  });

  it("learns nothing from an error seen once", async () => {
    const fs = projectFs();
    await fire(fs, "PostToolUseFailure", failure(ERROR));
    await fire(fs, "PostToolUse", { ...edit("src/cart.ts"), tool_response: { success: true } });
    await fire(fs, "PostToolUse", { ...edit("src/cart.ts"), tool_response: { success: true } });
    await fire(fs, "Stop", { stop_hook_active: false });
    assert.deepEqual(readLessons(fakeRuntime({ fs }), FM), []);
  });
});

const DAY = 86_400_000;
const daysAgo = (days: number): string => new Date(Date.parse(DEFAULT_NOW) - days * DAY).toISOString();

describe("learnings: expiry and deletion", () => {
  it("expires a lesson not matched in 90 days and counts it", async () => {
    const fs = projectFs([
      lesson({ id: "old", paths: ["a/**"], createdAt: daysAgo(200), lastMatchedAt: daysAgo(91) }),
      lesson({ id: "fresh", paths: ["b/**"], createdAt: daysAgo(200), lastMatchedAt: daysAgo(10) }),
    ]);
    const { body } = await cliJson(["learnings"], { runtime: fakeRuntime({ fs }), cwd: PROJECT });
    const ids = field(body, "data", "lessons");
    assert.deepEqual(Array.isArray(ids) ? ids.map((item: unknown) => field(item, "id")) : [], ["fresh"]);
    assert.equal(field(body, "data", "measure", "expired"), 1);
  });

  it("expires a lesson marked unhelpful twice", async () => {
    const fs = projectFs([lesson({ id: "meh", paths: ["a/**"] })]);
    const runtime = fakeRuntime({ fs });
    await cliJson(["learnings", "unhelpful", "meh"], { runtime, cwd: PROJECT });
    assert.equal(readLessons(runtime, FM).length, 1);
    await cliJson(["learnings", "unhelpful", "meh"], { runtime, cwd: PROJECT });
    assert.deepEqual(readLessons(runtime, FM), []);
  });

  it("adds, edits and deletes by hand", async () => {
    const fs = projectFs();
    const runtime = fakeRuntime({ fs });
    const added = await cliJson(
      ["learnings", "add", "--text", "Run migrations before seeding.", "--paths", "db/**", "--source", "correction"],
      {
        runtime,
        cwd: PROJECT,
      },
    );
    assert.equal(added.code, 0);
    const id = String(field(added.body, "data", "id"));
    await cliJson(["learnings", "edit", id, "--text", "Run the migrations, then seed."], { runtime, cwd: PROJECT });
    assert.equal(readLessons(runtime, FM)[0]?.text, "Run the migrations, then seed.");
    assert.equal((await cliJson(["learnings", "delete", id], { runtime, cwd: PROJECT })).code, 0);
    assert.deepEqual(readLessons(runtime, FM), []);
    assert.notEqual((await cliJson(["learnings", "delete", id], { runtime, cwd: PROJECT })).code, 0);
  });

  it("refuses a lesson without a key", async () => {
    const { code } = await cliJson(["learnings", "add", "--text", "Be careful."], {
      runtime: fakeRuntime({ fs: projectFs() }),
      cwd: PROJECT,
    });
    assert.notEqual(code, 0);
  });
});
