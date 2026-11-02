import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { EXCLUDE_FM, parseAddedLines } from "../gate/git.js";
import { cappedHashes, hashLines } from "../signals/line-hashes.js";

export const MAX_LINE_FILES = 50;
export const MAX_FILE_BYTES = 200_000;

export interface PathMark {
  readonly status: string;
  readonly size: number;
  readonly mtime: number;
}

export interface TreeSnapshot {
  readonly marks: Readonly<Record<string, PathMark>>;
  readonly lines: Readonly<Record<string, readonly string[]>> | null;
}

type SnapshotRuntime = Pick<Runtime, "git" | "stat" | "readText">;

const STATUS_ARGS = [
  "-c",
  "core.quotepath=off",
  "status",
  "--porcelain=v1",
  "-z",
  "--untracked-files=all",
  "--",
  ".",
  EXCLUDE_FM,
];

export const statusEntries = (runtime: Pick<Runtime, "git">, root: AbsolutePath): Map<string, string> | undefined => {
  const result = runtime.git(STATUS_ARGS, root);
  if (!result.ok) return undefined;
  const fields = result.stdout.split("\0");
  const entries = new Map<string, string>();
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? "";
    if (field.length < 4) continue;
    const status = field.slice(0, 2);
    entries.set(field.slice(3), status);
    if (status.startsWith("R") || status.startsWith("C")) index += 1;
  }
  return entries;
};

const markOf = (runtime: Pick<Runtime, "stat">, root: AbsolutePath, path: string, status: string): PathMark => {
  const stat = runtime.stat(toAbsolutePath(join(root, path)));
  return stat === undefined ? { status, size: -1, mtime: 0 } : { status, size: stat.size ?? 0, mtime: stat.mtimeMs };
};

const untrackedHashes = (runtime: Pick<Runtime, "readText">, root: AbsolutePath, path: string): readonly string[] => {
  const text = runtime.readText(toAbsolutePath(join(root, path)));
  return text.ok && text.value.length <= MAX_FILE_BYTES ? hashLines(text.value.split("\n")) : [];
};

export const addedHashes = (
  runtime: SnapshotRuntime,
  root: AbsolutePath,
  entries: ReadonlyMap<string, string>,
  files: readonly string[],
): Record<string, readonly string[]> => {
  const tracked = files.filter((file) => entries.get(file) !== "??");
  const diff =
    tracked.length === 0
      ? undefined
      : runtime.git(
          ["-c", "core.quotepath=off", "diff", "-U0", "--no-color", "--no-ext-diff", "HEAD", "--", ...tracked],
          root,
        );
  const added = diff?.ok === true ? parseAddedLines(diff.stdout) : [];
  const result: Record<string, readonly string[]> = {};
  for (const file of files) {
    const fresh = entries.get(file) === "??" || (diff !== undefined && !diff.ok);
    result[file] = fresh
      ? untrackedHashes(runtime, root, file)
      : hashLines(added.filter((line) => line.path === file).map((line) => line.text));
  }
  return result;
};

const capped = (hashes: Record<string, readonly string[]>): Record<string, readonly string[]> | null =>
  Object.values(hashes).some((list) => cappedHashes(list) === undefined) ? null : hashes;

export const takeSnapshot = (
  runtime: SnapshotRuntime,
  root: AbsolutePath,
  withLines: boolean,
): TreeSnapshot | undefined => {
  const entries = statusEntries(runtime, root);
  if (entries === undefined) return undefined;
  const marks: Record<string, PathMark> = {};
  for (const [path, status] of entries) marks[path] = markOf(runtime, root, path, status);
  const files = [...entries.keys()];
  const lines = withLines && files.length <= MAX_LINE_FILES ? capped(addedHashes(runtime, root, entries, files)) : null;
  return { marks, lines };
};

const sameMark = (left: PathMark | undefined, right: PathMark | undefined): boolean =>
  left?.status === right?.status && left?.size === right?.size && left?.mtime === right?.mtime;

export const changedPaths = (before: TreeSnapshot, after: TreeSnapshot): readonly string[] =>
  [...new Set([...Object.keys(before.marks), ...Object.keys(after.marks)])]
    .filter((path) => !sameMark(before.marks[path], after.marks[path]))
    .sort();
