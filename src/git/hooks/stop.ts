import type { AbsolutePath } from "../../core/brand.js";
import type { Runtime } from "../../core/runtime.js";
import type { HookDecision, HookHandler } from "../../hooks/handlers.js";
import type { Translate } from "../../i18n/translate.js";
import { mergeCommitsSince, mergeInProgress } from "../merge/inputs.js";
import type { Finding } from "../merge/types.js";
import { verifyMerge, type VerifyReport } from "../merge/verify.js";
import { readBaseline, readDirty, readEdits } from "../ownership.js";
import { openRepo, type Repo } from "../repo.js";
import { ownerOf } from "./context.js";
import { fileList } from "./messages.js";

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

const mergeReason = (t: Translate, item: MergeGateItem): string | undefined => {
  const commit = item.commit === "MERGE_HEAD" ? "MERGE_HEAD" : item.commit.slice(0, 12);
  if (item.report.exit === 2) return t("git.stop.merge_unanalyzed", { commit, detail: item.report.error ?? "" });
  if (item.report.exit === 1) {
    return t("git.stop.merge_lost", { commit, findings: fileList(item.report.findings.map(findingLabel)) });
  }
  return undefined;
};

export const gitStopReasons = (
  runtime: Runtime,
  root: AbsolutePath,
  owner: string,
  t: Translate,
): readonly string[] => {
  const repo = openRepo(runtime, root);
  if (repo === undefined) return [];
  const merges = mergeGateStatus(runtime, repo, owner).flatMap((item) => mergeReason(t, item) ?? []);
  const tree = worktreeGateStatus(runtime, repo, owner);
  return [
    ...merges,
    ...(tree.dirty.length > 0 ? [t("git.stop.dirty", { files: fileList(tree.dirty) })] : []),
    ...(tree.unpushed.length > 0
      ? [t("git.stop.unpushed", { count: tree.unpushed.length, branch: tree.branch ?? "HEAD" })]
      : []),
  ];
};

export const gitStop: HookHandler = (input): HookDecision => {
  const reasons = gitStopReasons(input.runtime, input.cwd, ownerOf(input.payload), input.t);
  return reasons.length === 0 ? { kind: "allow" } : { kind: "block", reason: reasons.join("\n") };
};
