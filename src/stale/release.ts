import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import type { IssueFact } from "./resolve.js";

export interface CommitInfo {
  readonly sha: string;
  readonly subject: string;
  readonly body: string;
}

export interface UnclosedIssue {
  readonly issue: number;
  readonly commits: readonly string[];
}

const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+((?:#\d+(?:\s*,\s*|\s+and\s+)?)+)/gi;
const RECORD = "\u001e";
const FIELD = "\u001f";
const FALLBACK_COMMITS = "100";

export const closedByMessage = (message: string): readonly number[] =>
  [
    ...new Set(
      [...message.matchAll(CLOSING)].flatMap((match) =>
        [...(match[1] ?? "").matchAll(/#(\d+)/g)].map((item) => Number(item[1])),
      ),
    ),
  ].sort((a, b) => a - b);

export const parseLog = (stdout: string): readonly CommitInfo[] =>
  stdout.split(RECORD).flatMap((record): CommitInfo[] => {
    const [sha = "", subject = "", body = ""] = record.replace(/^\n/, "").split(FIELD);
    return sha.trim() === "" ? [] : [{ sha: sha.trim(), subject, body: body.trim() }];
  });

export const defaultRange = (runtime: Pick<Runtime, "git">, root: AbsolutePath): string | undefined => {
  const tag = runtime.git(["describe", "--tags", "--abbrev=0", "HEAD^"], root);
  const name = tag.stdout.trim();
  return tag.ok && name !== "" ? `${name}..HEAD` : undefined;
};

export const commitsIn = (
  runtime: Pick<Runtime, "git">,
  root: AbsolutePath,
  range: string | undefined,
): readonly CommitInfo[] => {
  const format = "--format=%H%x1f%s%x1f%b%x1e";
  const args = range === undefined ? ["log", format, "-n", FALLBACK_COMMITS] : ["log", format, range];
  const result = runtime.git(args, root);
  return result.ok ? parseLog(result.stdout) : [];
};

export const unclosedIssues = (
  commits: readonly CommitInfo[],
  issues: ReadonlyMap<number, IssueFact>,
): readonly UnclosedIssue[] => {
  const byIssue = new Map<number, string[]>();
  for (const commit of commits) {
    for (const issue of closedByMessage(`${commit.subject}\n${commit.body}`)) {
      byIssue.set(issue, [...(byIssue.get(issue) ?? []), commit.sha.slice(0, 12)]);
    }
  }
  return [...byIssue.entries()]
    .filter(([issue]) => issues.get(issue)?.state === "open")
    .map(([issue, shas]) => ({ issue, commits: shas }))
    .sort((a, b) => a.issue - b.issue);
};
