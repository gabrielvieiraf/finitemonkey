import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { defaultOn } from "../defaults/items.js";
import { verifyMerge } from "../git/merge/verify.js";
import type { Repo } from "../git/repo.js";
import { acceptedFingerprints, EMPTY_BASELINE, loadBaseline } from "../secrets/baseline.js";
import { blocking } from "../secrets/rules/types.js";
import { diffFindings } from "../secrets/scan.js";
import { commitMessageProblems } from "./commit-msg.js";

export const HOOK_CHECKS = ["secrets", "commit-messages", "merges", "protected", "rules"] as const;

export type HookCheckId = (typeof HOOK_CHECKS)[number];

export interface HookCheck {
  readonly id: HookCheckId;
  readonly failures: readonly string[];
  readonly fix: string;
}

const DIFF_FLAGS = ["-U0", "--no-color", "--no-ext-diff", "--no-renames"] as const;

const short = (sha: string): string => sha.slice(0, 12);

export const secretsInRange = (runtime: Runtime, root: AbsolutePath, range: readonly string[]): HookCheck => {
  const log = runtime.git(["log", "-p", "--format=commit %H", ...DIFF_FLAGS, ...range, "--"], root);
  const baseline = loadBaseline(runtime, root);
  const accepted = acceptedFingerprints(baseline.ok ? baseline.value : EMPTY_BASELINE, runtime.now());
  const found = log.ok ? blocking(diffFindings(log.stdout)).filter((item) => !accepted.has(item.fingerprint)) : [];
  const failures = log.ok
    ? found.map(
        (item) =>
          `${item.ruleId} at ${item.file}:${String(item.line)}${item.commit === undefined ? "" : ` (${short(item.commit)})`}`,
      )
    : [`git log ${range.join(" ")} failed`];
  return { id: "secrets", failures, fix: "finitemonkey secrets scan --history" };
};

const RECORD = "\u001e";

export const commitMessagesInRange = (runtime: Runtime, root: AbsolutePath, range: readonly string[]): HookCheck => {
  const log = runtime.git(["log", "--no-merges", `--format=%H%x00%B${RECORD}`, ...range, "--"], root);
  const conventional = defaultOn(runtime, root, "conventional-commits");
  const failures = log.ok
    ? log.stdout
        .split(RECORD)
        .map((record) => record.replace(/^\n/, ""))
        .filter((record) => record.includes("\u0000"))
        .flatMap((record) => {
          const [sha = "", body = ""] = record.split("\u0000");
          return commitMessageProblems(body, conventional).map((problem) => `${short(sha)} ${problem}`);
        })
    : [`git log ${range.join(" ")} failed`];
  return { id: "commit-messages", failures, fix: "git rebase -i <base> and reword the listed commits" };
};

export const mergesInRange = (runtime: Runtime, repo: Repo, range: readonly string[]): HookCheck => {
  const listed = runtime.git(["rev-list", "--merges", ...range, "--"], repo.root);
  const merges = listed.ok ? listed.stdout.split("\n").filter((line) => line !== "") : [];
  const failures = merges.flatMap((sha) => {
    const report = verifyMerge(runtime, repo, { rev: sha });
    if (report.exit === 0) return [];
    return [
      report.exit === 2
        ? `${short(sha)} could not be analyzed`
        : `${short(sha)} dropped ${String(report.findings.length)} line(s)`,
    ];
  });
  return { id: "merges", failures, fix: "finitemonkey merge verify <merge-commit>" };
};

export const failing = (checks: readonly HookCheck[]): readonly HookCheck[] =>
  checks.filter((check) => check.failures.length > 0);
