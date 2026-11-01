import { dirname, isAbsolute, join, resolve } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { toPosixPath } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";
import type { GitWorktree } from "./git-list.js";

export interface FileWorktree extends GitWorktree {
  readonly activityMs: number | undefined;
}

export interface FileListing {
  readonly commonDir: AbsolutePath;
  readonly trees: readonly FileWorktree[];
}

const MAX_DEPTH = 64;

const text = (runtime: Runtime, path: string): string | undefined => {
  const read = runtime.readText(toAbsolutePath(path));
  return read.ok ? read.value.trim() : undefined;
};

const near = (from: string, target: string): string => (isAbsolute(target) ? target : resolve(from, target));

const commonDirFrom = (runtime: Runtime, dir: string): string | undefined => {
  const dotGit = join(dir, ".git");
  const kind = runtime.stat(toAbsolutePath(dotGit))?.kind;
  if (kind === "dir") return dotGit;
  const pointer = /^gitdir:\s*(.+)$/.exec(text(runtime, dotGit) ?? "")?.[1];
  if (pointer === undefined) return undefined;
  const gitDir = near(dir, pointer);
  const common = text(runtime, join(gitDir, "commondir"));
  return common === undefined ? undefined : near(gitDir, common);
};

const findCommonDir = (runtime: Runtime, cwd: AbsolutePath): string | undefined => {
  let dir: string = cwd;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    if (runtime.stat(toAbsolutePath(join(dir, ".git"))) !== undefined) return commonDirFrom(runtime, dir);
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
};

const activityMs = (runtime: Runtime, adminDir: string): number | undefined => {
  const times = ["HEAD", "index", join("logs", "HEAD")].flatMap(
    (name) => runtime.stat(toAbsolutePath(join(adminDir, name)))?.mtimeMs ?? [],
  );
  return times.length === 0 ? undefined : Math.max(...times);
};

const linkedTree = (runtime: Runtime, adminDir: string): FileWorktree | undefined => {
  const pointer = text(runtime, join(adminDir, "gitdir"));
  if (pointer === undefined || pointer === "") return undefined;
  const path = toPosixPath(dirname(near(adminDir, pointer)));
  const head = text(runtime, join(adminDir, "HEAD")) ?? "";
  const branch = /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1] ?? null;
  const locked = text(runtime, join(adminDir, "locked"));
  return {
    path,
    head: branch === null && head !== "" ? head : null,
    branch,
    bare: false,
    detached: branch === null,
    locked: locked ?? null,
    prunable: runtime.stat(toAbsolutePath(path)) === undefined,
    main: false,
    activityMs: activityMs(runtime, adminDir),
  };
};

export const fileWorktrees = (runtime: Runtime, cwd: AbsolutePath): FileListing | undefined => {
  const commonDir = findCommonDir(runtime, cwd);
  if (commonDir === undefined) return undefined;
  const admin = join(commonDir, "worktrees");
  const names = runtime.listDir(toAbsolutePath(admin));
  const trees = (names.ok ? names.value : []).flatMap((name) => linkedTree(runtime, join(admin, name)) ?? []);
  return { commonDir: toAbsolutePath(commonDir), trees };
};
