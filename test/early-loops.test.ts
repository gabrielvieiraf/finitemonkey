import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { Runtime } from "../src/core/runtime.js";
import type { HookEvent } from "../src/hooks/events.js";
import { composeDecisions, type HookHandler, type HookInput } from "../src/hooks/handlers.js";
import { parseHookPayload } from "../src/hooks/payload.js";
import { createTranslator } from "../src/i18n/translate.js";
import { withPolicy } from "../src/policy/guards.js";
import { POLICY_FILE } from "../src/policy/policy.js";
import {
  EARLY_GUARD,
  earlyLoopTriggers,
  editsSinceRun,
  failedInARow,
  ignoredError,
  REPRO_GUARD,
  reproduceFirst,
  SYNTAX_GUARD,
  syntaxAfterEdit,
} from "../src/signals/early.js";
import { namedFiles, signalsPostToolUse, signalsPostToolUseFailure } from "../src/signals/record.js";
import type { SignalEntry } from "../src/signals/store.js";
import { syntaxProblem } from "../src/signals/syntax.js";
import { memoryFs } from "./memory-fs.js";
import { cliJson, fakeRuntime } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const at = (relative: string): string => toAbsolutePath(join(ROOT, relative));
const t = createTranslator("en");
const base = { at: "2026-10-26T12:00:00.000Z", session: "s1", turn: 1 };

const edit = (file: string): SignalEntry => ({ ...base, kind: "edit", file, hash: file, undo: false });
const failed = (file: string, why: "tool" | "syntax" = "tool"): SignalEntry => ({
  ...base,
  kind: "edit_failed",
  file,
  why,
});
const run: SignalEntry = { ...base, kind: "run", tool: "Bash" };
const error = (files: readonly string[], tool = "Bash"): SignalEntry => ({
  ...base,
  kind: "error",
  sig: "abc",
  sample: "boom",
  tool,
  ...(files.length === 0 ? {} : { files }),
});

describe("early loop triggers: fixtures with hard negatives", () => {
  it("failed edits in a row on the same file", () => {
    assert.equal(failedInARow([failed("a.ts"), failed("a.ts"), failed("a.ts")], "a.ts"), 3);
    assert.equal(
      failedInARow([edit("a.ts"), failed("a.ts", "syntax"), edit("a.ts"), failed("a.ts", "syntax")], "a.ts"),
      2,
    );
    assert.equal(
      failedInARow([failed("a.ts"), failed("a.ts"), edit("a.ts"), failed("a.ts")], "a.ts"),
      1,
      "a success resets",
    );
    assert.equal(failedInARow([failed("a.ts"), failed("b.ts"), failed("a.ts")], "a.ts"), 2, "other files do not count");
  });

  it("edits with nothing run in between", () => {
    assert.equal(editsSinceRun([edit("a.ts"), edit("b.ts"), edit("c.ts")]), 3);
    assert.equal(editsSinceRun([edit("a.ts"), run, edit("b.ts"), run, edit("c.ts")]), 1, "a run in between resets");
    assert.equal(editsSinceRun([edit("a.ts"), edit("b.ts"), error([]), edit("c.ts")]), 1, "a failing run also counts");
    assert.equal(
      editsSinceRun([edit("a.ts"), edit("b.ts"), error([], "Edit"), edit("c.ts")]),
      3,
      "edit errors are not runs",
    );
  });

  it("an error in tool output that the next edit ignores", () => {
    assert.deepEqual(ignoredError([error(["parser.ts"]), edit("src/view.ts")], "src/view.ts"), ["parser.ts"]);
    assert.equal(
      ignoredError([error(["parser.ts"]), edit("src/parser.ts")], "src/parser.ts"),
      undefined,
      "edits what failed",
    );
    assert.equal(ignoredError([error([]), edit("src/view.ts")], "src/view.ts"), undefined, "the error names no file");
    assert.equal(ignoredError([error(["parser.ts"]), run, edit("src/view.ts")], "src/view.ts"), undefined, "ran first");
  });

  it("names files from compiler and stack trace output", () => {
    assert.deepEqual(namedFiles("src/foo/bar.ts:12:3 - error TS2322\n    at Object.<anonymous> (/x/y/baz.js:3:4)"), [
      "bar.ts",
      "baz.js",
    ]);
    assert.deepEqual(namedFiles("exit code 1, version 1.2.3"), []);
  });
});

describe("syntax right after the edit", () => {
  it("reports JSON, JavaScript and TypeScript syntax errors and passes valid files", () => {
    assert.ok(syntaxProblem("a.json", '{\n"a": ,\n}'));
    assert.equal(syntaxProblem("a.json", '{"a": 1}'), undefined);
    assert.equal(syntaxProblem("a.js", "const a = 1;\nconst b = ;\n")?.line, 2);
    assert.equal(syntaxProblem("a.js", "const a = 1;\n"), undefined);
    assert.equal(
      syntaxProblem("a.mjs", 'import x from "y";\nexport const b = x;\n'),
      undefined,
      "modules are not flagged",
    );
    assert.equal(syntaxProblem("a.md", "# {{ not code"), undefined, "unknown types are skipped");
    const strip = (code: string): string => code.replace(": number", "");
    assert.ok(syntaxProblem("a.ts", "const b: number = ;\n", strip));
    assert.equal(syntaxProblem("a.ts", "const b: number = 2;\n", strip), undefined);
  });
});

const SESSION = { session_id: "s1", cwd: ROOT };

const inputOf = (runtime: Runtime, event: HookEvent, raw: Readonly<Record<string, unknown>>): HookInput => {
  const parsed = parseHookPayload(event, JSON.stringify({ ...SESSION, hook_event_name: event, ...raw }), false);
  assert.ok(parsed.ok);
  return { event, payload: parsed.value, cwd: ROOT, runtime, t, env: {} };
};

const project = (files: Readonly<Record<string, string>>) => {
  const fs = memoryFs(
    Object.fromEntries(Object.entries(files).map(([path, text]) => [at(path), text])),
    [at(".git"), at(".finitemonkey")],
    "2026-10-26T12:00:00.000Z",
  );
  return { fs, runtime: fakeRuntime({ fs }) };
};

const guarded = (id: string, event: HookEvent, handler: HookHandler): readonly HookHandler[] =>
  withPolicy({ id, damage: false, handlers: { [event]: [handler] } })[event] ?? [];

const afterEdit = async (runtime: Runtime, file: string) => {
  const raw = { tool_name: "Write", tool_input: { file_path: at(file), content: "x" }, tool_response: {} };
  await signalsPostToolUse(inputOf(runtime, "PostToolUse", raw));
  const syntax = await composeDecisions(
    inputOf(runtime, "PostToolUse", raw),
    guarded(SYNTAX_GUARD, "PostToolUse", syntaxAfterEdit),
  );
  const early = await composeDecisions(
    inputOf(runtime, "PostToolUse", raw),
    guarded(EARLY_GUARD, "PostToolUse", earlyLoopTriggers),
  );
  return { syntax, early };
};

const reasonOf = (decision: Awaited<ReturnType<typeof composeDecisions>>): string =>
  decision.kind === "block" ? decision.reason : "";

describe("early loop hooks", () => {
  it("a syntax error is returned to the agent in the PostToolUse of the same edit", async () => {
    const { runtime } = project({ [POLICY_FILE]: "guards:\n  syntax-check: active\n", "data.json": '{"a": ,}' });
    const { syntax } = await afterEdit(runtime, "data.json");
    assert.equal(syntax.kind, "block");
    assert.match(reasonOf(syntax), /data\.json does not parse after this edit/);
  });

  it("starts in shadow: the syntax error is logged, not returned", async () => {
    const { fs, runtime } = project({ "data.json": '{"a": ,}' });
    const { syntax } = await afterEdit(runtime, "data.json");
    assert.equal(syntax.kind, "allow");
    assert.match(fs.read(at(".finitemonkey/log.jsonl")) ?? "", /"event":"guard_shadow","guard":"syntax-check"/);
  });

  it("the third edit with nothing run in between gets one nudge, and a run in between avoids it", async () => {
    const { runtime } = project({ [POLICY_FILE]: "guards:\n  early-loops: active\n" });
    assert.equal((await afterEdit(runtime, "a.ts")).early.kind, "allow");
    assert.equal((await afterEdit(runtime, "b.ts")).early.kind, "allow");
    assert.match(reasonOf((await afterEdit(runtime, "c.ts")).early), /3 edits in a row with nothing run/);
    assert.equal((await afterEdit(runtime, "d.ts")).early.kind, "allow", "once per streak");

    const other = project({ [POLICY_FILE]: "guards:\n  early-loops: active\n" }).runtime;
    const ran = { tool_name: "Bash", tool_input: { command: "npm test" }, tool_response: { exitCode: 0 } };
    await afterEdit(other, "a.ts");
    await afterEdit(other, "b.ts");
    await signalsPostToolUse(inputOf(other, "PostToolUse", ran));
    assert.equal((await afterEdit(other, "c.ts")).early.kind, "allow");
  });

  it("the third failed edit on one file in a row is flagged", async () => {
    const { runtime } = project({ [POLICY_FILE]: "guards:\n  early-loops: active\n" });
    const failure = {
      tool_name: "Edit",
      tool_input: { file_path: at("a.ts"), old_string: "x", new_string: "y" },
      error: "String to replace not found in file",
    };
    const handlers = guarded(EARLY_GUARD, "PostToolUseFailure", earlyLoopTriggers);
    const once = async () => {
      await signalsPostToolUseFailure(inputOf(runtime, "PostToolUseFailure", failure));
      return composeDecisions(inputOf(runtime, "PostToolUseFailure", failure), handlers);
    };
    assert.equal((await once()).kind, "allow");
    assert.equal((await once()).kind, "allow");
    assert.match(reasonOf(await once()), /3 failed edits in a row on a\.ts/);
  });
});

const TASK = (size: string): string =>
  `id: fix\ngoal: fix the parser\nsize: ${size}\nacceptance:\n  - id: M1\n    check: manual\n    description: parse the sample file\n`;

describe("reproduce first on M and L tasks", () => {
  const write = { tool_name: "Write", tool_input: { file_path: at("src/a.ts"), content: "x" } };
  const files = (size: string) => ({
    [POLICY_FILE]: "guards:\n  reproduce-first: active\n",
    ".finitemonkey/state.json": '{"active":"fix"}\n',
    ".finitemonkey/tasks/fix.yml": TASK(size),
  });
  const before = (runtime: Runtime) =>
    composeDecisions(inputOf(runtime, "PreToolUse", write), guarded(REPRO_GUARD, "PreToolUse", reproduceFirst));

  it("an M task without reproduction gets one prompt before the first edit", async () => {
    const { runtime } = project(files("M"));
    assert.match(reasonOf(await before(runtime)), /task fix is size M and nothing in this session reproduces/);
    assert.equal((await before(runtime)).kind, "allow", "only once");
  });

  it("S tasks skip it, and a failing command or a located place satisfies it", async () => {
    assert.equal((await before(project(files("S")).runtime)).kind, "allow");

    const failing = project(files("M")).runtime;
    const output = {
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      tool_response: { exitCode: 1, stderr: "Error: parse failed at sample.txt" },
    };
    await signalsPostToolUse(inputOf(failing, "PostToolUse", output));
    assert.equal((await before(failing)).kind, "allow");

    const located = project(files("M")).runtime;
    const result = await cliJson(["signals", "locate", "src/parser.ts:42", "the tokenizer drops the last line"], {
      cwd: ROOT,
      runtime: located,
    });
    assert.equal(result.code, 0);
    assert.equal((await before(located)).kind, "allow");
  });

  it("starts in shadow", async () => {
    const { fs, runtime } = project({
      ".finitemonkey/state.json": '{"active":"fix"}\n',
      ".finitemonkey/tasks/fix.yml": TASK("L"),
    });
    assert.equal((await before(runtime)).kind, "allow");
    assert.match(fs.read(at(".finitemonkey/log.jsonl")) ?? "", /"guard":"reproduce-first"/);
  });
});
