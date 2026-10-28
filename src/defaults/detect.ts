import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { isConventionalHeader } from "../githooks/commit-msg.js";
import type { CommitStyle } from "./items.js";

export const SAMPLE_COMMITS = 30;
export const MIN_COMMITS = 10;
export const CONVENTIONAL_SHARE = 0.5;

export interface DetectedCommits {
  readonly style: CommitStyle;
  readonly conventional: number;
  readonly total: number;
}

export const detectCommitStyle = (runtime: Pick<Runtime, "git">, root: AbsolutePath): DetectedCommits | undefined => {
  const log = runtime.git(["log", "-n", String(SAMPLE_COMMITS), "--no-merges", "--format=%s"], root);
  if (!log.ok) return undefined;
  const subjects = log.stdout.split("\n").filter((line) => line.trim() !== "");
  if (subjects.length < MIN_COMMITS) return undefined;
  const conventional = subjects.filter(isConventionalHeader).length;
  const style = conventional / subjects.length >= CONVENTIONAL_SHARE ? "conventional" : "free";
  return { style, conventional, total: subjects.length };
};
