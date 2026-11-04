import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { DirProbe, EntryKind } from "./data-dir-layout.js";
import type { DataDirFs } from "./data-dir-migrate.js";

const kindOf = (path: string): EntryKind => {
  try {
    return statSync(path).isDirectory() ? "dir" : "file";
  } catch {
    return "missing";
  }
};

const entriesOf = (path: string): readonly string[] => {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
};

export const nodeDirProbe: DirProbe = { kind: kindOf, entries: entriesOf };

const attempt = (action: () => void): boolean => {
  try {
    action();
    return true;
  } catch {
    return false;
  }
};

const readText = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

const gitIgnored = (root: string, path: string): boolean | undefined => {
  const result = spawnSync("git", ["check-ignore", "-q", "--", path], { cwd: root, timeout: 5000, windowsHide: true });
  if (result.status === 0) return true;
  return result.status === 1 ? false : undefined;
};

export const nodeDataDirFs: DataDirFs = {
  ...nodeDirProbe,
  rename: (from, to) =>
    attempt(() => {
      renameSync(from, to);
    }),
  readText,
  append: (path, text) =>
    attempt(() => {
      appendFileSync(path, text);
    }),
  mark: (path) =>
    attempt(() => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "");
    }),
  gitIgnored,
};
