import { join } from "node:path";

import { DATA_DIR_NAME, LEGACY_DATA_DIR } from "./data-dir-name.js";

export { DATA_DIR_NAME, DATA_DIR_NAMES, HOME_DATA_DIR, LEGACY_DATA_DIR } from "./data-dir-name.js";

export const GITIGNORE_LINE = `${DATA_DIR_NAME}/*`;
export const GITIGNORE_PROBE = `${DATA_DIR_NAME}/state.json`;
export const GITIGNORE_MARK = join("cache", "gitignore-checked");

const MARKERS: ReadonlySet<string> = new Set([
  "state.json",
  "trust.json",
  "log.jsonl",
  "config.yml",
  "lock.json",
  "policy.yml",
  "rules.yml",
  "tasks",
  "evidence",
  "cache",
  "allow",
  "runtime",
  "locks",
  "backups",
  "reports",
  "merge-dropped.json",
]);

export type EntryKind = "dir" | "file" | "missing";

export interface DirProbe {
  readonly kind: (path: string) => EntryKind;
  readonly entries: (path: string) => readonly string[];
}

export const isDataDir = (probe: DirProbe, path: string): boolean => {
  if (probe.kind(path) !== "dir") return false;
  const entries = probe.entries(path);
  return entries.length === 0 || entries.some((entry) => MARKERS.has(entry));
};

export type DataDirState = "fresh" | "current" | "pending" | "foreign" | "vendored";

export const dataDirState = (probe: DirProbe, root: string): DataDirState => {
  const current = join(root, DATA_DIR_NAME);
  const legacy = join(root, LEGACY_DATA_DIR);
  if (probe.kind(current) !== "missing") return isDataDir(probe, current) ? "current" : "foreign";
  if (probe.kind(legacy) !== "dir") return "fresh";
  return probe.kind(join(legacy, "runtime")) === "dir" ? "vendored" : "pending";
};

export const dataDirFor = (state: DataDirState): string =>
  state === "fresh" || state === "current" ? DATA_DIR_NAME : LEGACY_DATA_DIR;

export const findProjectRoot = (probe: DirProbe, start: string): string => {
  let dir = start;
  for (;;) {
    if (probe.kind(join(dir, ".git")) !== "missing") return dir;
    const parent = join(dir, "..");
    if (parent === dir) return start;
    dir = parent;
  }
};
