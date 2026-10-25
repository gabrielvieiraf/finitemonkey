import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import type { ExecRequest, ExecResult, Runtime } from "../src/core/runtime.js";
import { execResult } from "./support.js";

export interface Repo {
  readonly root: AbsolutePath;
  readonly write: (path: string, text: string) => void;
  readonly read: (path: string) => string;
  readonly remove: (path: string) => void;
  readonly git: (...args: readonly string[]) => string;
  readonly commit: (message: string) => void;
  readonly cleanup: () => void;
}

export const makeRepo = (files: Readonly<Record<string, string>> = {}): Repo => {
  const root = toAbsolutePath(mkdtempSync(join(tmpdir(), "fm-repo-")));
  const git = (...args: readonly string[]): string => {
    const result = spawnSync("git", [...args], { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout;
  };
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  for (const [path, text] of Object.entries(files)) write(path, text);
  const commit = (message: string): void => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
  };
  if (Object.keys(files).length > 0) commit("init");
  return {
    root,
    write,
    read: (path) => readFileSync(join(root, path), "utf8"),
    remove: (path) => {
      rmSync(join(root, path), { force: true, recursive: true });
    },
    git,
    commit,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
};

export type GhScript = (args: readonly string[]) => ExecResult | undefined;

export const GH_NOT_LOGGED_IN: GhScript = (args) =>
  args[0] === "auth" ? execResult(1, "", "not logged in") : undefined;

export const ghWith =
  (view: ExecResult): GhScript =>
  (args) => {
    if (args[0] === "auth") return execResult(0, "Logged in");
    if (args[0] === "pr" && args[1] === "view") return view;
    if (args[0] === "pr" && args[1] === "list") return execResult(0, "[]");
    return undefined;
  };

export const NO_PR: GhScript = (args) => {
  if (args[0] === "auth") return execResult(0, "Logged in");
  if (args[0] === "pr" && args[1] === "view") return execResult(1, "", 'no pull requests found for branch "main"');
  return args[0] === "pr" && args[1] === "list" ? execResult(0, "[]") : undefined;
};

export interface RepoRuntimeOptions {
  readonly gh?: GhScript;
  readonly now?: () => string;
  readonly failAppend?: boolean;
  readonly spawned?: string[][];
}

export const repoRuntime = (options: RepoRuntimeOptions = {}): Runtime => {
  const base = nodeRuntime();
  const gh = options.gh ?? GH_NOT_LOGGED_IN;
  return {
    ...base,
    exec: (request: ExecRequest) =>
      request.command === "gh" ? (gh(request.args) ?? execResult(1, "", "unexpected gh call")) : base.exec(request),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.failAppend === true ? { appendText: () => ({ ok: false, error: "EACCES" }) as const } : {}),
    spawnSelf: (args) => {
      options.spawned?.push([...args]);
      return true;
    },
  };
};

export const PASSING_TEST = [
  'const { test } = require("node:test");',
  'const assert = require("node:assert");',
  'test("adds", () => { assert.equal(1 + 1, 2); });',
  'test("keeps", () => { assert.ok(true); });',
  "",
].join("\n");
