import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import type { JsonObject } from "../src/core/parsed.js";
import type { HookEvent } from "../src/hooks/events.js";
import type { HookDecision, HookHandler } from "../src/hooks/handlers.js";
import { createTranslator } from "../src/i18n/translate.js";

export const runtime = nodeRuntime();
export const t = createTranslator("en");

export const git = (cwd: string, ...args: readonly string[]): string => {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
};

export const write = (root: string, path: string, content: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};

export interface TempRepo {
  readonly root: AbsolutePath;
  readonly dispose: () => void;
}

export const tempDir = (prefix: string): AbsolutePath =>
  toAbsolutePath(realpathSync(mkdtempSync(join(tmpdir(), prefix))));

export const initRepo = (root: string, branch = "main"): void => {
  git(root, "init", "-q", "-b", branch);
  git(root, "config", "user.name", "Ana");
  git(root, "config", "user.email", "ana@example.com");
  git(root, "config", "core.autocrlf", "false");
};

export const tempRepo = (files: Readonly<Record<string, string>> = { "README.md": "hello\n" }): TempRepo => {
  const root = tempDir("fm-git-");
  initRepo(root);
  for (const [path, content] of Object.entries(files)) write(root, path, content);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return {
    root,
    dispose: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
};

export const SESSION = "session-a";

export const hook = async (
  handler: HookHandler,
  event: HookEvent,
  cwd: AbsolutePath,
  raw: JsonObject = {},
): Promise<HookDecision> =>
  handler({
    event,
    cwd,
    runtime,
    t,
    payload: {
      hookEventName: event,
      sessionId: SESSION,
      cwd,
      stopHookActive: false,
      raw: { session_id: SESSION, ...raw },
    },
  });

export const bash = (command: string): JsonObject => ({ tool_name: "Bash", tool_input: { command } });

export const edit = (path: string): JsonObject => ({ tool_name: "Edit", tool_input: { file_path: path } });

export const reasonOf = (decision: HookDecision): string => (decision.kind === "block" ? decision.reason : "");
