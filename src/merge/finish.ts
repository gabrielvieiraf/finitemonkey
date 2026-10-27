import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { DROPPED_FILE } from "../git/merge/dropped.js";
import { verifyMerge } from "../git/merge/verify.js";
import { openRepo } from "../git/repo.js";
import type { MergeCheck, MergeStop, SemanticCandidate } from "./report.js";
import { openCallers } from "./semantic.js";

const CHECK_TIMEOUT_MS = 600_000;

export interface DroppedEntry {
  readonly file: string;
  readonly side: string;
  readonly reason: string;
  readonly text?: string;
}

export interface Finished {
  readonly checks: readonly MergeCheck[];
  readonly callers: readonly SemanticCandidate[];
  readonly stops: readonly MergeStop[];
}

const writeDropped = (
  runtime: Runtime,
  dir: AbsolutePath,
  dropped: readonly DroppedEntry[],
): AbsolutePath | undefined => {
  if (dropped.length === 0) return undefined;
  const path = toAbsolutePath(join(dir, DROPPED_FILE));
  runtime.mkdir(toAbsolutePath(join(dir, ".finitemonkey")));
  const items = dropped.map((item) => ({ ...item, approved_by: "declared removal" }));
  runtime.writeText(path, `${JSON.stringify({ dropped: items }, null, 2)}\n`);
  return path;
};

const verifyCheck = (runtime: Runtime, dir: AbsolutePath, dropped: readonly DroppedEntry[]): MergeCheck => {
  const repo = openRepo(runtime, dir);
  if (repo === undefined)
    return { name: "merge verify", command: "finitemonkey merge verify", ok: false, detail: "no repo" };
  const droppedFile = writeDropped(runtime, dir, dropped);
  const report = verifyMerge(runtime, repo, droppedFile === undefined ? {} : { droppedFile });
  const detail =
    report.exit === 2
      ? (report.error ?? "unanalyzable")
      : report.findings.map((finding) => `${finding.file}: ${finding.kind} ${finding.text}`).join("; ");
  return { name: "merge verify", command: "finitemonkey merge verify", ok: report.exit === 0, detail };
};

const commandCheck = (runtime: Runtime, dir: AbsolutePath, command: string): MergeCheck => {
  const result = runtime.exec({ command, args: [], cwd: dir, timeoutMs: CHECK_TIMEOUT_MS, shell: true });
  const detail = `${result.stdout}\n${result.stderr}`.trim().split("\n").slice(-3).join(" | ");
  return { name: "check", command, ok: result.exitCode === 0, detail };
};

export const finishChecks = (
  runtime: Runtime,
  dir: AbsolutePath,
  base: string,
  commands: readonly string[],
  dropped: readonly DroppedEntry[],
): Finished => {
  const verify = verifyCheck(runtime, dir, dropped);
  const callers = openCallers(runtime, dir, base);
  const callersCheck: MergeCheck = {
    name: "callers",
    command: "finitemonkey gate (callers)",
    ok: callers.length === 0,
    detail: callers.map((item) => `${item.symbol} at ${item.file}`).join("; "),
  };
  const checks = [verify, callersCheck, ...commands.map((command) => commandCheck(runtime, dir, command))];
  const stops = checks
    .filter((check) => !check.ok)
    .map((check) => ({ reason: `${check.name}: ${check.detail}`.slice(0, 500), path: null }));
  return { checks, callers, stops };
};

export const commitMerge = (runtime: Runtime, dir: AbsolutePath): string | undefined => {
  const committed = runtime.gitWith(["commit", "--no-edit"], dir, {});
  if (!committed.ok) return undefined;
  const head = runtime.git(["rev-parse", "HEAD"], dir);
  return head.ok ? head.stdout.trim() : undefined;
};
