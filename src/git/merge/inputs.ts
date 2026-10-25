import { accept, type Parsed, reject } from "../../core/parsed.js";
import type { Runtime } from "../../core/runtime.js";
import type { Repo } from "../repo.js";
import { worktreeTree } from "../tree.js";
import { DIFF_ARGS, parseUnifiedDiff } from "./diff-parse.js";
import type { FileDiff, MergeInputs } from "./types.js";

const revParse = (runtime: Runtime, repo: Repo, rev: string): string | undefined => {
  const result = runtime.git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], repo.root);
  const value = result.stdout.trim();
  return result.ok && value !== "" ? value : undefined;
};

const parentsOf = (runtime: Runtime, repo: Repo, commit: string): readonly string[] => {
  const result = runtime.git(["rev-list", "--parents", "-n", "1", commit], repo.root);
  return result.ok ? result.stdout.trim().split(" ").slice(1) : [];
};

const basesOf = (runtime: Runtime, repo: Repo, ours: string, theirs: string): readonly string[] => {
  const result = runtime.git(["merge-base", "--all", ours, theirs], repo.root);
  return result.ok ? result.stdout.split("\n").filter((line) => line !== "") : [];
};

const withBase = (runtime: Runtime, repo: Repo, ours: string, theirs: string, result: string, label: string): Parsed<MergeInputs> => {
  const bases = basesOf(runtime, repo, ours, theirs);
  const base = bases[0];
  if (base === undefined) return reject("no merge base between the two sides");
  return accept({ base, ours, theirs, result, resultLabel: label, bases: bases.length });
};

const inProgress = (runtime: Runtime, repo: Repo): Parsed<MergeInputs> | undefined => {
  const theirs = revParse(runtime, repo, "MERGE_HEAD");
  const ours = revParse(runtime, repo, "HEAD");
  if (theirs === undefined || ours === undefined) return undefined;
  const tree = worktreeTree(runtime, repo, ours, { timeoutMs: 60000, stamp: `verify-${runtime.now().replace(/[:.]/g, "-")}` });
  if (!tree.ok) return reject(tree.error);
  return withBase(runtime, repo, ours, theirs, tree.value, "working tree");
};

export const resolveMergeInputs = (runtime: Runtime, repo: Repo, rev: string | undefined): Parsed<MergeInputs> => {
  if (rev === undefined) {
    const pending = inProgress(runtime, repo);
    if (pending !== undefined) return pending;
  }
  const commit = revParse(runtime, repo, rev ?? "HEAD");
  if (commit === undefined) return reject(`not a commit: ${rev ?? "HEAD"}`);
  const parents = parentsOf(runtime, repo, commit);
  const [ours, theirs] = parents;
  if (parents.length !== 2 || ours === undefined || theirs === undefined) {
    return reject(parents.length > 2 ? "octopus merges are not analyzed" : `not a merge commit: ${commit}`);
  }
  return withBase(runtime, repo, ours, theirs, commit, commit);
};

export const sideDiff = (runtime: Runtime, repo: Repo, from: string, to: string): Parsed<readonly FileDiff[]> => {
  const result = runtime.git([...DIFF_ARGS, from, to], repo.root);
  return result.ok ? accept(parseUnifiedDiff(result.stdout)) : reject(`git diff ${from} ${to} failed`);
};

export const blobText = (runtime: Runtime, repo: Repo, rev: string, path: string): string | undefined => {
  const result = runtime.git(["cat-file", "blob", `${rev}:${path}`], repo.root);
  return result.ok ? result.stdout : undefined;
};

export const blobId = (runtime: Runtime, repo: Repo, rev: string, path: string): string | undefined => {
  const result = runtime.git(["rev-parse", "--verify", "--quiet", `${rev}:${path}`], repo.root);
  const value = result.stdout.trim();
  return result.ok && value !== "" ? value : undefined;
};

export const mergeCommitsSince = (runtime: Runtime, repo: Repo, since: string | undefined): readonly string[] => {
  const range = since === undefined ? ["HEAD", "--not", "--remotes"] : [`${since}..HEAD`];
  const result = runtime.git(["rev-list", "--merges", ...range], repo.root);
  return result.ok ? result.stdout.split("\n").filter((line) => line !== "") : [];
};

export const mergeInProgress = (runtime: Runtime, repo: Repo): boolean => revParse(runtime, repo, "MERGE_HEAD") !== undefined;
