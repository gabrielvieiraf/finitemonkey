import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { performance } from "node:perf_hooks";

import type { AbsolutePath } from "../src/core/brand.js";
import type { JsonObject } from "../src/core/parsed.js";
import type { Runtime } from "../src/core/runtime.js";
import { gitSessionStart } from "../src/git/hooks/session.js";
import type { HookHandler, HookInput } from "../src/hooks/handlers.js";
import { createTranslator } from "../src/i18n/translate.js";
import { cli } from "../test/support.js";
import type { CorpusCase } from "./evidence-corpus.js";
import type { CaseResult } from "./evidence-rates.js";

const SESSION = "evidence-session";
const t = createTranslator("en");

const git = (cwd: string, ...args: readonly string[]): void => {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
};

const write = (root: string, path: string, text: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

const inputFor = (runtime: Runtime, root: AbsolutePath, raw: JsonObject): HookInput => ({
  event: "PreToolUse",
  cwd: root,
  runtime,
  t,
  env: {},
  payload: { hookEventName: "PreToolUse", sessionId: SESSION, cwd: root, stopHookActive: false, raw },
});

export interface Fixture {
  readonly dispose: () => void;
}

export const prepareFixture = async (runtime: Runtime, root: AbsolutePath): Promise<Fixture> => {
  const compiled = await cli(["rules", "compile", "--json"], { cwd: root, runtime, env: {}, version: "1.0.0" });
  if (compiled.code !== 0) throw new Error(`rules compile failed: ${compiled.stdout}${compiled.stderr}`);
  git(root, "add", "-A");
  git(root, "commit", "-q", "--allow-empty", "-m", "rules");
  const remote = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-evidence-remote-")));
  const worktree = `${root}-wt`;
  git(remote, "init", "-q", "--bare", "-b", "main");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-q", "-u", "origin", "main");
  git(root, "switch", "-q", "-c", "merged");
  git(root, "switch", "-q", "-c", "unmerged");
  write(root, "x.txt", "x\n");
  git(root, "add", "x.txt");
  git(root, "commit", "-q", "-m", "x");
  git(root, "switch", "-q", "-c", "feat/own", "main");
  write(root, "y.txt", "y\n");
  git(root, "add", "y.txt");
  git(root, "commit", "-q", "-m", "y");
  git(root, "push", "-q", "-u", "origin", "feat/own");
  git(root, "worktree", "add", "-q", worktree, "-b", "wt");
  await gitSessionStart({
    ...inputFor(runtime, root, {}),
    event: "SessionStart",
    payload: { hookEventName: "SessionStart", sessionId: SESSION, cwd: root, stopHookActive: false, raw: {} },
  });
  return {
    dispose: () => {
      rmSync(remote, { recursive: true, force: true });
      rmSync(worktree, { recursive: true, force: true });
    },
  };
};

const PATH_FIELDS = ["file_path", "notebook_path"] as const;

export const absoluteInput = (root: string, input: JsonObject): JsonObject => {
  const out: Record<string, unknown> = { ...input };
  for (const field of PATH_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value !== "" && !isAbsolute(value)) out[field] = join(root, value);
  }
  return out;
};

const seed = (root: string, item: CorpusCase): (() => void) => {
  const before = new Map<string, string | undefined>();
  for (const [path, text] of Object.entries(item.files)) {
    const full = join(root, path);
    before.set(path, existsSync(full) ? readFileSync(full, "utf8") : undefined);
    write(root, path, text);
  }
  if (item.staged.length > 0) git(root, "add", "--", ...item.staged);
  return () => {
    if (item.staged.length > 0) git(root, "reset", "-q", "--", ...item.staged);
    for (const [path, text] of before) {
      if (text === undefined) rmSync(join(root, path), { force: true });
      else writeFileSync(join(root, path), text);
    }
  };
};

export const replayCase = async (
  runtime: Runtime,
  root: AbsolutePath,
  handlers: readonly HookHandler[],
  item: CorpusCase,
): Promise<CaseResult> => {
  const restore = seed(root, item);
  try {
    const input = inputFor(runtime, root, {
      ...item.payload,
      session_id: SESSION,
      cwd: root,
      hook_event_name: "PreToolUse",
      tool_name: item.tool,
      tool_input: absoluteInput(root, item.input),
    });
    const start = performance.now();
    let blocked = false;
    for (const handler of handlers) {
      if ((await handler(input)).kind === "block") {
        blocked = true;
        break;
      }
    }
    return { item, blocked, ms: performance.now() - start };
  } finally {
    restore();
  }
};

export const replayGuard = async (
  runtime: Runtime,
  root: AbsolutePath,
  handlers: readonly HookHandler[],
  cases: readonly CorpusCase[],
): Promise<readonly CaseResult[]> => {
  const results: CaseResult[] = [];
  for (const item of cases) results.push(await replayCase(runtime, root, handlers, item));
  return results;
};
