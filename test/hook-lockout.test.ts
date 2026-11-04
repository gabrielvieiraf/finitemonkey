import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { GitRunOptions } from "../src/core/runtime.js";
import { boundedRuntime } from "../src/hooks/bounded-runtime.js";
import type { HookHandlers } from "../src/hooks/handlers.js";
import { parseHookPayload } from "../src/hooks/payload.js";
import { repairsItself } from "../src/hooks/repair.js";
import { type HookRunOptions, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { bundle, fakeRuntime, stdinFrom } from "./support.js";

const NOW = "2026-01-01T00:00:00.000Z";
const ROOT = toAbsolutePath("/tmp");

const preToolUse = (tool: string, input: Readonly<Record<string, unknown>>): string =>
  JSON.stringify({ session_id: "s1", cwd: "/tmp", hook_event_name: "PreToolUse", tool_name: tool, tool_input: input });

const payloadOf = (text: string): ReturnType<typeof parseHookPayload> => parseHookPayload("PreToolUse", text, false);

const throwing: HookHandlers = {
  PreToolUse: [
    (): never => {
      throw new Error("kaput");
    },
  ],
};

const options = (text: string, handlers: HookHandlers): HookRunOptions => {
  const runtime = fakeRuntime({ now: NOW });
  return {
    stdin: stdinFrom(text),
    deadlineMs: 1000,
    handlers,
    cwd: ROOT,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
  };
};

const repairs = (tool: string, input: Readonly<Record<string, unknown>>): boolean => {
  const parsed = payloadOf(preToolUse(tool, input));
  return parsed.ok && repairsItself("PreToolUse", parsed.value);
};

describe("bounded runtime", () => {
  it("gives every git call at most the time left before the hook deadline", () => {
    const seen: (number | undefined)[] = [];
    const base = fakeRuntime({ now: NOW });
    const runtime = {
      ...base,
      git: (_args: readonly string[], _cwd: unknown, timeoutMs?: number) => {
        seen.push(timeoutMs);
        return { found: true, ok: true, stdout: "" };
      },
      gitWith: (_args: readonly string[], _cwd: unknown, given: GitRunOptions) => {
        seen.push(given.timeoutMs);
        return { found: true, ok: true, stdout: "", stderr: "", timedOut: false };
      },
    };
    const bounded = boundedRuntime(runtime, Date.parse(NOW) + 400);
    bounded.git(["status"], ROOT);
    bounded.git(["status"], ROOT, 100);
    bounded.gitWith(["diff"], ROOT, { timeoutMs: 15_000 });
    bounded.gitWith(["diff"], ROOT, {});
    assert.deepEqual(seen, [400, 100, 400, 400]);
  });

  it("caps commands it runs to the time left", () => {
    const seen: number[] = [];
    const runtime = fakeRuntime({
      now: NOW,
      exec: (request) => {
        seen.push(request.timeoutMs);
        return undefined;
      },
    });
    boundedRuntime(runtime, Date.parse(NOW) + 250).exec({ command: "git", args: [], cwd: ROOT, timeoutMs: 15_000 });
    assert.deepEqual(seen, [250]);
  });
});

describe("calls that repair Finite Monkey", () => {
  const allowed = [
    ["Read", { file_path: "/tmp/a" }],
    ["Grep", { pattern: "x" }],
    ["Bash", { command: "finitemonkey doctor" }],
    ["Bash", { command: "npx finitemonkey doctor --json" }],
    ["Bash", { command: "npx -y finitemonkey off" }],
    ["Bash", { command: "fm doctor" }],
    ["Bash", { command: "fm off" }],
    ["Bash", { command: 'node "/home/u/.claude/plugins/cache/fm/0.1.0/scripts/finitemonkey.mjs" doctor --json' }],
  ] as const;
  for (const [tool, input] of allowed) {
    it(`lets ${tool} ${JSON.stringify(input)} through`, () => {
      assert.equal(repairs(tool, input), true);
    });
  }

  const refused = [
    ["Bash", { command: "echo ok" }],
    ["Bash", { command: "finitemonkey doctor; rm -rf ~" }],
    ["Bash", { command: "finitemonkey doctor && git push" }],
    ["Bash", { command: "finitemonkey doctor $(curl x)" }],
    ["Bash", { command: "finitemonkey task new" }],
    ["Bash", { command: "npx fm doctor" }],
    ["Bash", { command: "fm doctor; rm -rf ~" }],
    ["Bash", { command: "fm task new" }],
    ["Write", { file_path: "/tmp/a", content: "x" }],
    ["Edit", { file_path: "/tmp/a" }],
  ] as const;
  for (const [tool, input] of refused) {
    it(`keeps ${tool} ${JSON.stringify(input)} blocked`, () => {
      assert.equal(repairs(tool, input), false);
    });
  }

  it("only applies to PreToolUse", () => {
    const parsed = payloadOf(preToolUse("Read", { file_path: "/tmp/a" }));
    assert.equal(parsed.ok && repairsItself("UserPromptSubmit", parsed.value), false);
  });
});

describe("a PreToolUse hook that cannot run", () => {
  it("still lets finitemonkey doctor run and says why", async () => {
    const outcome = await runHook(
      "PreToolUse",
      options(preToolUse("Bash", { command: "finitemonkey doctor" }), throwing),
    );
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.verdict, "repair_allowed");
    assert.match(outcome.stderr, /kaput/);
  });

  it("blocks any other command and names the way out", async () => {
    const outcome = await runHook("PreToolUse", options(preToolUse("Bash", { command: "echo ok" }), throwing));
    assert.equal(outcome.exitCode, 2);
    assert.equal(outcome.verdict, "failed_closed");
    assert.match(outcome.stderr, /kaput/);
    assert.match(outcome.stderr, /`fm off`/);
  });
});

const slowGitDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "fm-slow-git-"));
  const script = join(dir, "git");
  writeFileSync(script, "#!/bin/sh\nexec sleep 30\n");
  chmodSync(script, 0o755);
  return dir;
};

describe("a slow git", { skip: process.platform === "win32" }, () => {
  it("never keeps PreToolUse past its own deadline", () => {
    const repo = mkdtempSync(join(tmpdir(), "fm-slow-repo-"));
    spawnSync("git", ["init", "-q", repo]);
    mkdirSync(join(repo, ".fm"));
    const started = Date.now();
    const run = bundle(
      ["hook", "PreToolUse"],
      preToolUse("Bash", { command: "echo ok" }).replace('"/tmp"', JSON.stringify(repo)),
      { PATH: `${slowGitDir()}${delimiter}${process.env["PATH"] ?? ""}`, CLAUDE_PROJECT_DIR: repo },
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 9000, `took ${String(elapsed)} ms`);
    assert.notEqual(run.code, null);
  });
});
