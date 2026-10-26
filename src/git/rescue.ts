import { accept, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { Repo } from "./repo.js";

export interface LostCommit {
  readonly sha: string;
  readonly when: string;
  readonly subject: string;
  readonly source: "reflog" | "dangling";
  readonly ref: string | undefined;
}

export interface RescueReport {
  readonly commits: readonly LostCommit[];
  readonly blobs: number;
}

const REFLOG_LIMIT = 300;
const LIST_LIMIT = 50;
const SHA = /^[0-9a-f]{40,64}$/;

const linesOf = (text: string): readonly string[] => text.split("\n").filter((line) => line.trim() !== "");

interface ReflogLine {
  readonly sha: string;
  readonly ref: string;
}

const reflogLines = (runtime: Runtime, repo: Repo): readonly ReflogLine[] => {
  const result = runtime.git(["reflog", "show", "--all", `-n${String(REFLOG_LIMIT)}`, "--format=%H %gD"], repo.root);
  if (!result.ok) return [];
  return linesOf(result.stdout).flatMap((line) => {
    const [sha, ref] = line.split(" ");
    return sha === undefined || ref === undefined || !SHA.test(sha) || ref.startsWith("refs/finitemonkey/")
      ? []
      : [{ sha, ref }];
  });
};

const unreachable = (runtime: Runtime, repo: Repo, shas: readonly string[]): ReadonlySet<string> => {
  if (shas.length === 0) return new Set();
  const result = runtime.git(["rev-list", ...shas, "--not", "--branches", "--tags", "--remotes"], repo.root);
  return new Set(result.ok ? linesOf(result.stdout) : []);
};

const fsckDangling = (
  runtime: Runtime,
  repo: Repo,
): { readonly commits: readonly string[]; readonly blobs: number } => {
  const result = runtime.git(["fsck", "--no-reflogs", "--no-progress", "--dangling"], repo.root);
  const lines = linesOf(result.stdout);
  const pick = (kind: string): readonly string[] =>
    lines.flatMap((line) => {
      const [label, type, sha] = line.split(" ");
      return label === "dangling" && type === kind && sha !== undefined ? [sha] : [];
    });
  return { commits: pick("commit"), blobs: pick("blob").length };
};

const describe = (runtime: Runtime, repo: Repo, shas: readonly string[]): ReadonlyMap<string, [string, string]> => {
  if (shas.length === 0) return new Map();
  const result = runtime.git(["log", "--no-walk=unsorted", "--format=%H%x09%cr%x09%s", ...shas], repo.root);
  return new Map(
    linesOf(result.stdout).flatMap((line) => {
      const [sha, when, ...subject] = line.split("\t");
      return sha === undefined ? [] : [[sha, [when ?? "", subject.join("\t")]] as const];
    }),
  );
};

export const rescueReport = (runtime: Runtime, repo: Repo): RescueReport => {
  const reflog = reflogLines(runtime, repo);
  const lost = unreachable(runtime, repo, [...new Set(reflog.map((line) => line.sha))]);
  const fromReflog = reflog.filter(
    (line, index) => lost.has(line.sha) && reflog.findIndex((other) => other.sha === line.sha) === index,
  );
  const seen = new Set(fromReflog.map((line) => line.sha));
  const dangling = fsckDangling(runtime, repo);
  const extra = dangling.commits.filter((sha) => !seen.has(sha));
  const details = describe(runtime, repo, [...fromReflog.map((line) => line.sha), ...extra].slice(0, LIST_LIMIT));
  const commit = (sha: string, source: LostCommit["source"], ref: string | undefined): LostCommit[] => {
    const detail = details.get(sha);
    return detail === undefined ? [] : [{ sha, when: detail[0], subject: detail[1], source, ref }];
  };
  return {
    commits: [
      ...fromReflog.flatMap((line) => commit(line.sha, "reflog", line.ref)),
      ...extra.flatMap((sha) => commit(sha, "dangling", undefined)),
    ],
    blobs: dangling.blobs,
  };
};

export const restoreBranch = (runtime: Runtime, repo: Repo, sha: string, branch: string): Parsed<string> => {
  const commit = runtime.git(["rev-parse", "--verify", "--quiet", `${sha}^{commit}`], repo.root).stdout.trim();
  if (commit === "") return reject(`not a commit: ${sha}`);
  if (!runtime.git(["check-ref-format", "--branch", branch], repo.root).ok) return reject(`invalid branch: ${branch}`);
  if (runtime.git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repo.root).ok) {
    return reject(`branch already exists: ${branch}`);
  }
  const made = runtime.gitWith(["branch", branch, commit], repo.root, {});
  return made.ok ? accept(commit) : reject(made.stderr.trim() || "git branch failed");
};
