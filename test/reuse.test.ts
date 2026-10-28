import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { JsonObject } from "../src/core/parsed.js";
import type { Runtime } from "../src/core/runtime.js";
import type { HookEvent } from "../src/hooks/events.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { readReuseLog, shouldRetire } from "../src/reuse/log.js";
import { isGeneric } from "../src/reuse/names.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { field, parseBody, stdinFrom } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const MONEY = [
  'import { CENTS } from "./cents";',
  "",
  "export const CENTS_PER_UNIT = 100;",
  "",
  "export const parseAmount = (text: string): number => Number(text);",
  "",
  'export const render = (): string => "";',
  "",
  "export function init(): void {}",
  "",
  "// money",
  "export const formatMoney = (cents: number): string => (cents / 100).toFixed(2);",
  "",
].join("\n");

const project = (): Repo => {
  const repo = makeRepo({ "src/lib/money.ts": MONEY, ".finitemonkey/config.yml": "lang: en\n" });
  repos.push(repo);
  return repo;
};

const fire = (
  repo: Repo,
  event: HookEvent,
  payload: JsonObject,
  runtime: Runtime = repoRuntime(),
): Promise<HookOutcome> =>
  runHook(event, {
    stdin: stdinFrom(JSON.stringify({ hook_event_name: event, session_id: "s1", cwd: repo.root, ...payload })),
    deadlineMs: 20_000,
    handlers: DEFAULT_HANDLERS,
    cwd: repo.root,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });

const write = (repo: Repo, file: string, content: string, runtime?: Runtime): Promise<HookOutcome> => {
  repo.write(file, content);
  return fire(
    repo,
    "PostToolUse",
    { tool_name: "Write", tool_input: { file_path: join(repo.root, file), content }, tool_response: { success: true } },
    runtime,
  );
};

const contextOf = (outcome: HookOutcome): string => {
  if (outcome.stdout.trim() === "") return "";
  const text = field(parseBody(outcome.stdout), "hookSpecificOutput", "additionalContext");
  return typeof text === "string" ? text : "";
};

describe("reuse warning: a new definition with the name of an existing one", () => {
  it("adds one line naming both places", async () => {
    const repo = project();
    const outcome = await write(repo, "src/page/x.ts", "export const formatMoney = (n: number) => `R$ ${n}`;\n");
    assert.equal(
      contextOf(outcome),
      "finitemonkey reuse: `formatMoney` new in `src/page/x.ts`; `formatMoney` exists in `src/lib/money.ts:12`.",
    );
  });

  it("compares names without case, underscores or dashes, and only new definitions of an Edit", async () => {
    const repo = project();
    repo.write("src/page/y.py", "def other():\n    pass\n");
    const edit = await fire(repo, "PostToolUse", {
      tool_name: "Edit",
      tool_input: {
        file_path: join(repo.root, "src/page/y.py"),
        old_string: "def other():",
        new_string: "def parse_amount(text):\n    return 0\n\ndef other():",
      },
      tool_response: { success: true },
    });
    assert.match(
      contextOf(edit),
      /`parse_amount` new in `src\/page\/y\.py`; `parseAmount` exists in `src\/lib\/money\.ts:5`/,
    );
  });
});

describe("reuse warning: generic names never warn", () => {
  it("render, init, get and short names stay quiet", async () => {
    const repo = project();
    const outcome = await write(
      repo,
      "src/page/z.ts",
      "export const render = () => 1;\nexport function init() {}\nexport const get = 1;\nexport const fmt = 2;\n",
    );
    assert.equal(contextOf(outcome), "");
    for (const name of ["render", "init", "get", "handle", "Handle", "fmt"]) assert.ok(isGeneric(name), name);
    assert.ok(!isGeneric("formatMoney"));
  });
});

describe("reuse warning: outcome per warning", () => {
  it("records reused when the new definition is removed and kept when it is still there at the next request", async () => {
    const repo = project();
    await write(repo, "src/page/x.ts", "export const formatMoney = (n: number) => `${n}`;\n");
    await write(repo, "src/page/w.ts", "export const parseAmount = (t: string) => Number(t);\n");
    await write(
      repo,
      "src/page/x.ts",
      'import { formatMoney } from "../lib/money";\nexport const label = formatMoney(1);\n',
    );
    await fire(repo, "UserPromptSubmit", { prompt: "Now add the receipt email" });
    const log = readReuseLog(repoRuntime(), fmPaths(repo.root));
    assert.deepEqual(
      log.warnings.map((item) => [item.name, item.outcome]),
      [
        ["formatMoney", "reused"],
        ["parseAmount", "kept"],
      ],
    );
    assert.match(repo.read(".finitemonkey/log.jsonl"), /"event":"reuse.warning","id":1,"name":"formatMoney"/);
  });
});

describe("reuse warning: fails open", () => {
  it("lets the edit through and logs the failure when git grep cannot run", async () => {
    const repo = project();
    const base = repoRuntime();
    const broken: Runtime = {
      ...base,
      exec: (request) =>
        request.args.includes("grep")
          ? { found: false, exitCode: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 }
          : base.exec(request),
    };
    const outcome = await write(repo, "src/page/x.ts", "export const formatMoney = 1;\n", broken);
    assert.equal(outcome.verdict, "allow");
    assert.equal(contextOf(outcome), "");
    assert.match(repo.read(".finitemonkey/log.jsonl"), /"event":"reuse.failed","detail":"git not found"/);
  });

  it("lets the edit through and logs the failure when the index throws", async () => {
    const repo = project();
    const base = repoRuntime();
    const throwing: Runtime = {
      ...base,
      exec: (request) => {
        if (request.args.includes("grep")) throw new Error("index exploded");
        return base.exec(request);
      },
    };
    const outcome = await write(repo, "src/page/x.ts", "export const formatMoney = 1;\n", throwing);
    assert.equal(outcome.verdict, "allow");
    assert.match(repo.read(".finitemonkey/log.jsonl"), /"event":"reuse.failed","detail":"index exploded"/);
  });
});

describe("reuse warning: leaves the core when it rarely leads to reuse", () => {
  it("retires after 100 resolved warnings with fewer than 20% reused", () => {
    const warning = (id: number, outcome: "reused" | "kept") => ({
      id,
      at: "",
      session: "s",
      name: `name${String(id)}`,
      file: "a.ts",
      existing: "b.ts:1",
      outcome,
    });
    const few = Array.from({ length: 99 }, (_, id) => warning(id, id < 10 ? "reused" : "kept"));
    assert.equal(shouldRetire({ warnings: few, retired: false }), false);
    const hundred = Array.from({ length: 100 }, (_, id) => warning(id, id < 19 ? "reused" : "kept"));
    assert.equal(shouldRetire({ warnings: hundred, retired: false }), true);
    const useful = Array.from({ length: 100 }, (_, id) => warning(id, id < 20 ? "reused" : "kept"));
    assert.equal(shouldRetire({ warnings: useful, retired: false }), false);
  });
});
