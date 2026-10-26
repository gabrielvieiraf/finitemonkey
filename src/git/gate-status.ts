import type { Runtime } from "../core/runtime.js";
import { mergeCommitsSince, mergeInProgress } from "./merge/inputs.js";
import type { Finding } from "./merge/types.js";
import { verifyMerge, type VerifyReport } from "./merge/verify.js";
import { readBaseline, readDirty, readEdits } from "./ownership.js";
import type { Repo } from "./repo.js";

export interface WorktreeGateStatus {
  readonly branch: string | undefined;
  readonly dirty: readonly string[];
  readonly unpushed: readonly string[];
}

export interface MergeGateItem {
  readonly commit: string;
  readonly report: VerifyReport;
}

const lines = (text: string): readonly string[] => text.split("\n").filter((line) => line.trim() !== "");

const unpushedSince = (runtime: Runtime, repo: Repo, since: string): readonly string[] => {
  if (lines(runtime.git(["remote"], repo.root).stdout).length === 0) return [];
  const result = runtime.git(["rev-list", `${since}..HEAD`, "--not", "--remotes"], repo.root);
  return result.ok ? lines(result.stdout) : [];
};

export const worktreeGateStatus = (runtime: Runtime, repo: Repo, owner: string): WorktreeGateStatus => {
  const edits = readEdits(runtime, repo, owner);
  const dirty = (readDirty(runtime, repo.root) ?? []).map((entry) => entry.path).filter((path) => edits.has(path));
  const since = readBaseline(runtime, repo, owner)?.head;
  const branch = runtime.git(["symbolic-ref", "--quiet", "--short", "HEAD"], repo.root).stdout.trim();
  return {
    branch: branch === "" ? undefined : branch,
    dirty,
    unpushed: since === undefined ? [] : unpushedSince(runtime, repo, since),
  };
};

export const mergeGateStatus = (runtime: Runtime, repo: Repo, owner: string): readonly MergeGateItem[] => {
  const since = readBaseline(runtime, repo, owner)?.head;
  const pending = mergeInProgress(runtime, repo) ? [{ commit: "MERGE_HEAD", report: verifyMerge(runtime, repo) }] : [];
  const commits = since === undefined ? [] : mergeCommitsSince(runtime, repo, since);
  return [...pending, ...commits.map((commit) => ({ commit, report: verifyMerge(runtime, repo, { rev: commit }) }))];
};

export const findingLabel = (finding: Finding): string => {
  const where = finding.line === undefined ? finding.file : `${finding.file}:${String(finding.line)}`;
  return `${where} ${finding.text === "" ? finding.kind : `"${finding.text}"`}`;
};
