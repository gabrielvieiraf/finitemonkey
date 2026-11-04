import { join } from "node:path";

import {
  DATA_DIR_NAME,
  dataDirState,
  type DirProbe,
  GITIGNORE_LINE,
  GITIGNORE_MARK,
  GITIGNORE_PROBE,
  LEGACY_DATA_DIR,
} from "./data-dir-layout.js";

export interface DataDirFs extends DirProbe {
  readonly rename: (from: string, to: string) => boolean;
  readonly readText: (path: string) => string | undefined;
  readonly append: (path: string, text: string) => boolean;
  readonly mark: (path: string) => boolean;
  readonly gitIgnored: (root: string, path: string) => boolean | undefined;
}

export type Migration = "none" | "renamed" | "rename_failed" | "foreign" | "vendored";

export const migrateDataDir = (fs: DataDirFs, root: string): Migration => {
  const state = dataDirState(fs, root);
  if (state === "foreign" || state === "vendored") return state;
  if (state !== "pending") return "none";
  return fs.rename(join(root, LEGACY_DATA_DIR), join(root, DATA_DIR_NAME)) ? "renamed" : "rename_failed";
};

const appendLine = (fs: DataDirFs, file: string): boolean => {
  const text = fs.readText(file) ?? "";
  const lead = text === "" || text.endsWith("\n") ? "" : "\n";
  return fs.append(file, `${lead}${GITIGNORE_LINE}\n`);
};

export type GitignoreOutcome = "skipped" | "ignored" | "added" | "failed";

export const ensureIgnored = (fs: DataDirFs, root: string): GitignoreOutcome => {
  const dir = join(root, DATA_DIR_NAME);
  const mark = join(dir, GITIGNORE_MARK);
  if (dataDirState(fs, root) !== "current" || fs.kind(mark) !== "missing") return "skipped";
  const ignored = fs.gitIgnored(root, GITIGNORE_PROBE);
  if (ignored === undefined) return "skipped";
  const outcome = ignored ? "ignored" : appendLine(fs, join(root, ".gitignore")) ? "added" : "failed";
  if (outcome !== "failed") fs.mark(mark);
  return outcome;
};

export const prepareDataDir = (fs: DataDirFs, root: string): Migration => {
  const migration = migrateDataDir(fs, root);
  ensureIgnored(fs, root);
  return migration;
};
