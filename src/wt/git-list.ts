import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { withoutCarriageReturn } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";

export interface GitWorktree {
  readonly path: string;
  readonly head: string | null;
  readonly branch: string | null;
  readonly bare: boolean;
  readonly detached: boolean;
  readonly locked: string | null;
  readonly prunable: boolean;
  readonly main: boolean;
}

const READ_ONLY = { GIT_OPTIONAL_LOCKS: "0" } as const;

const blockOf = (lines: readonly string[], main: boolean): GitWorktree | undefined => {
  const value = (name: string): string | undefined => {
    const line = lines.find((item) => item === name || item.startsWith(`${name} `));
    return line === undefined ? undefined : line.slice(name.length + 1);
  };
  const path = value("worktree");
  if (path === undefined || path === "") return undefined;
  const branch = value("branch");
  return {
    path,
    head: value("HEAD") ?? null,
    branch: branch === undefined ? null : branch.replace(/^refs\/heads\//, ""),
    bare: value("bare") !== undefined,
    detached: value("detached") !== undefined,
    locked: value("locked") ?? null,
    prunable: value("prunable") !== undefined,
    main,
  };
};

export const parseWorktreeList = (stdout: string): readonly GitWorktree[] =>
  stdout
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split("\n")
        .map(withoutCarriageReturn)
        .filter((line) => line !== ""),
    )
    .filter((lines) => lines.length > 0)
    .flatMap((lines, index) => blockOf(lines, index === 0) ?? []);

export const gitWorktrees = (runtime: Runtime, cwd: AbsolutePath): readonly GitWorktree[] | undefined => {
  const listed = runtime.gitWith(["worktree", "list", "--porcelain"], cwd, { env: READ_ONLY });
  return listed.ok ? parseWorktreeList(listed.stdout) : undefined;
};

const mtimeOf = (runtime: Runtime, path: AbsolutePath): number | undefined => runtime.stat(path)?.mtimeMs;

export const activityOf = (runtime: Runtime, tree: GitWorktree): string | undefined => {
  const dir = toAbsolutePath(tree.path);
  if (runtime.stat(dir) === undefined) return undefined;
  const gitDir = runtime.gitWith(["rev-parse", "--absolute-git-dir"], dir, { env: READ_ONLY });
  const commit = runtime.gitWith(["log", "-1", "--format=%ct", "HEAD"], dir, { env: READ_ONLY });
  const commitMs = commit.ok ? Number.parseInt(commit.stdout.trim(), 10) * 1000 : Number.NaN;
  const marks = gitDir.ok
    ? ["index", "HEAD", join("logs", "HEAD")].map((name) =>
        mtimeOf(runtime, toAbsolutePath(join(gitDir.stdout.trim(), name))),
      )
    : [];
  const times = [commitMs, ...marks].filter((time): time is number => time !== undefined && Number.isFinite(time));
  return times.length === 0 ? undefined : new Date(Math.max(...times)).toISOString();
};
