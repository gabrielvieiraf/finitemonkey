import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { readBook } from "../src/conceitos/book.js";
import { toAbsolutePath } from "../src/core/brand.js";
import { isRecord, type JsonObject, parseJsonObject } from "../src/core/parsed.js";
import type { HookEvent } from "../src/hooks/events.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { COMMITTED_STATE } from "../src/install/layout.js";
import { fmPaths } from "../src/task/paths.js";
import { type MemoryFs, memoryFs } from "./memory-fs.js";
import { SAMPLES } from "./secret-samples.js";
import { cliJson, fakeRuntime, field, parseBody, ROOT, stdinFrom } from "./support.js";

const PROJECT = toAbsolutePath("/home/ana/project");
const at = (path: string) => toAbsolutePath(join(PROJECT, path));
const PATHS = fmPaths(PROJECT);

const projectFs = (files: Readonly<Record<string, string>> = {}): MemoryFs =>
  memoryFs({
    [at(".git/HEAD")]: "ref: refs/heads/main\n",
    [at(".finitemonkey/config.yml")]: "lang: en\n",
    ...Object.fromEntries(Object.entries(files).map(([path, text]) => [at(path), text])),
  });

const fire = (fs: MemoryFs, event: HookEvent, payload: JsonObject, spawned: string[][] = []): Promise<HookOutcome> => {
  const runtime = fakeRuntime({ fs, spawned });
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

const secretWrite: JsonObject = {
  tool_name: "Write",
  tool_input: { file_path: at("src/github.ts"), content: `export const token = "${SAMPLES.githubPat}";\n` },
};

const parts = (outcome: HookOutcome): { readonly reason: string; readonly message: string } => {
  const body = parseBody(outcome.stdout);
  return {
    reason: String(field(body, "hookSpecificOutput", "permissionDecisionReason")),
    message: String(field(body, "systemMessage")),
  };
};

describe("concept book: the same block in two tones", () => {
  it("a new concept gets the long message once, then the one-line message, with the same block", async () => {
    const fs = projectFs();
    const first = parts(await fire(fs, "PreToolUse", secretWrite));
    const second = parts(await fire(fs, "PreToolUse", secretWrite));
    assert.equal(first.reason, second.reason);
    assert.match(
      first.message,
      /Kept a credential out.*Why it matters: .*The safe way: .*How to check later: finitemonkey secrets scan comes back green\./,
    );
    assert.equal(second.message, "finitemonkey: Kept a credential out of a file, command or commit.");
    assert.equal(readBook(fakeRuntime({ fs }), PATHS).concepts["secret-in-code"]?.level, "explained");
  });

  it("a person advanced in security gets the one-line message from the start", async () => {
    const perfil = "domains:\n  security:\n    tool: 80\n    knowledge: 85\n";
    const outcome = parts(await fire(projectFs({ ".finitemonkey/perfil.yml": perfil }), "PreToolUse", secretWrite));
    assert.doesNotMatch(outcome.message, /Why it matters/);
    assert.match(outcome.reason, /blocked/);
  });
});

describe("concept book: updated in the background at Stop, local and deleted by perfil forget", () => {
  it("Stop leaves the message for a background update, which records the concepts seen", async () => {
    const fs = projectFs();
    const spawned: string[][] = [];
    await fire(
      fs,
      "Stop",
      { stop_hook_active: false, last_assistant_message: "Added an idempotency key to the payment webhook." },
      spawned,
    );
    assert.deepEqual(spawned, [["conceitos", "update"]]);
    const runtime = fakeRuntime({ fs });
    const updated = await cliJson(["conceitos", "update"], { cwd: PROJECT, runtime });
    assert.deepEqual(field(updated.body, "data", "seen"), ["webhook", "idempotency"]);
    assert.equal(fs.read(at(".finitemonkey/cache/conceitos-pending.txt")), undefined);
    const shown = await cliJson(["conceitos"], { cwd: PROJECT, runtime });
    assert.equal(field(shown.body, "data", "concepts", "webhook", "level"), "seen");
  });

  it("the teacher agent marks the concepts it explained", async () => {
    const fs = projectFs();
    await fire(fs, "PostToolUse", {
      tool_name: "Agent",
      tool_input: { subagent_type: "finitemonkey:teacher", prompt: "Explain database migration for this person" },
      tool_response: {},
    });
    assert.equal(readBook(fakeRuntime({ fs }), PATHS).concepts.migration?.level, "explained");
  });

  it("lives in an ignored path and perfil forget deletes it", async () => {
    const fs = projectFs({ ".finitemonkey/conceitos.yml": "concepts:\n  api:\n    level: seen\n" });
    assert.ok(!COMMITTED_STATE.some((kept) => "conceitos.yml".startsWith(kept)));
    const runtime = fakeRuntime({ fs });
    const forgot = await cliJson(["perfil", "forget"], { cwd: PROJECT, runtime });
    assert.equal(field(forgot.body, "data", "removed"), 1);
    assert.equal(fs.read(at(".finitemonkey/conceitos.yml")), undefined);
  });

  it("leaves .finitemonkey only through conceitos export", async () => {
    const fs = projectFs({ ".finitemonkey/conceitos.yml": "concepts:\n  api:\n    level: seen\n" });
    const exported = await cliJson(["conceitos", "export"], { cwd: PROJECT, runtime: fakeRuntime({ fs }) });
    assert.equal(exported.code, 0);
    assert.equal(field(exported.body, "data", "concepts", "api", "level"), "seen");
  });
});

const fixture = (): JsonObject => {
  const parsed = parseJsonObject(readFileSync(join(ROOT, "test", "fixtures", "conceitos", "alarm.json"), "utf8"));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};

const planta = (value: unknown): string =>
  `${JSON.stringify({ schemaVersion: 1, ...Object.fromEntries(Object.entries(isRecord(value) ? value : {}).filter(([key]) => key !== "type")) })}\n`;

describe("concept book: alarm when the blueprint grows and the book stays flat", () => {
  it("fires once on the fixture and proposes a you-do-I-review task", async () => {
    const data = fixture();
    const fs = projectFs({
      ".finitemonkey/conceitos.yml": String(data["book"]),
      ".finitemonkey/cache/planta.json": planta(data["plantaBefore"]),
    });
    const quiet = parts2(await fire(fs, "Stop", { stop_hook_active: false, last_assistant_message: "ok" }));
    assert.equal(quiet, "");
    fs.writeText(at(".finitemonkey/cache/planta.json"), planta(data["plantaAfter"]));
    const alarm = parts2(await fire(fs, "Stop", { stop_hook_active: false, last_assistant_message: "ok" }));
    assert.match(alarm, /gained 4 blueprint items while the concept book stayed at 1 levels/);
    assert.match(alarm, /"you do, I review"/);
    assert.equal(parts2(await fire(fs, "Stop", { stop_hook_active: false, last_assistant_message: "ok" })), "");
  });
});

const parts2 = (outcome: HookOutcome): string => {
  if (outcome.stdout.trim() === "") return "";
  const message = field(parseBody(outcome.stdout), "systemMessage");
  return typeof message === "string" && message.includes("concept book") ? message : "";
};
