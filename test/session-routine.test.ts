import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { JsonObject } from "../src/core/parsed.js";
import { ROUTINE_MAX_BYTES } from "../src/gate/hooks/routine.js";
import type { HookEvent } from "../src/hooks/events.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field, parseBody, stdinFrom } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const project = async (size?: "S" | "M" | "L", goal = "Member pays with Pix"): Promise<Repo> => {
  const repo = makeRepo({
    "src/pay.ts": "export const pay = () => 1;\n",
    ".finitemonkey/look.yml": "port: 5173\nstart: npm run dev\n",
  });
  repos.push(repo);
  if (size !== undefined) {
    await cliJson(["task", "new", "t1", "--goal", goal, "--size", size, "--tests", "npm test -- pay"], {
      cwd: repo.root,
      runtime: repoRuntime(),
    });
  }
  return repo;
};

const fire = (repo: Repo, event: HookEvent, payload: JsonObject): Promise<HookOutcome> => {
  const runtime = repoRuntime();
  return runHook(event, {
    stdin: stdinFrom(JSON.stringify({ hook_event_name: event, session_id: "s1", cwd: repo.root, ...payload })),
    deadlineMs: 20_000,
    handlers: DEFAULT_HANDLERS,
    cwd: repo.root,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });
};

const contextOf = (outcome: HookOutcome): string => {
  if (outcome.stdout.trim() === "") return "";
  const text = field(parseBody(outcome.stdout), "hookSpecificOutput", "additionalContext");
  return typeof text === "string" ? text : "";
};

describe("SessionStart startup routine", () => {
  it("injects nothing without an active contract", async () => {
    const repo = await project();
    assert.equal(contextOf(await fire(repo, "SessionStart", { source: "startup" })), "");
  });

  it("injects nothing for a small task", async () => {
    const repo = await project("S");
    assert.equal(contextOf(await fire(repo, "SessionStart", { source: "resume" })), "");
  });

  it("lists directory, task state, last commits, how to start the app and one check, for an M task", async () => {
    const repo = await project("M");
    const text = contextOf(await fire(repo, "SessionStart", { source: "resume" }));
    assert.match(text, /task t1 \(size M\) is active/);
    assert.ok(text.includes(`- working directory: ${repo.root}`), text);
    assert.match(text, /- task: Member pays with Pix; last gate: not run yet/);
    assert.match(text, /- last commits: [0-9a-f]+ init/);
    assert.match(text, /- start the app: npm run dev/);
    assert.match(text, /- one end-to-end check before the first edit: npm test -- pay/);
    assert.ok(Buffer.byteLength(text, "utf8") <= ROUTINE_MAX_BYTES);
  });

  it("stays under the context budget even with a long goal", async () => {
    const repo = await project("L", "x".repeat(5000));
    const text = contextOf(await fire(repo, "SessionStart", { source: "startup" }));
    assert.match(text, /size L/);
    assert.ok(Buffer.byteLength(text, "utf8") <= ROUTINE_MAX_BYTES, String(Buffer.byteLength(text, "utf8")));
  });
});

describe("PermissionDenied in the log", () => {
  it("records the tool and the rule", async () => {
    const repo = await project();
    repo.write(".finitemonkey/config.yml", "lang: en\n");
    await fire(repo, "PermissionDenied", {
      tool_name: "Bash",
      tool_input: { command: "git push origin main" },
      tool_use_id: "toolu_1",
      reason: "Bash(git push:*) denied by auto mode",
    });
    const log = repo.read(".finitemonkey/log.jsonl");
    assert.match(log, /"event":"permission.denied","tool":"Bash","rule":"Bash\(git push:\*\) denied by auto mode"/);
  });
});
