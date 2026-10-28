import type { AbsolutePath } from "../../core/brand.js";
import type { Runtime } from "../../core/runtime.js";
import { readLedger } from "../../spend/ledger.js";
import { fmPaths } from "../../task/paths.js";
import { type Classification, classifyLog } from "./classify.js";
import { type CheckState, failedLog, type GhCounter, type PullRequest, readChecks } from "./gh.js";
import { readWatch, recordEvidence, writeWatch } from "./state.js";

export interface WatchLimits {
  readonly maxAttempts: number;
  readonly maxUsd: number;
  readonly timeoutMs: number;
  readonly intervalMs: number;
  readonly maxCalls: number;
}

export const DEFAULT_LIMITS: WatchLimits = {
  maxAttempts: 3,
  maxUsd: 5,
  timeoutMs: 30 * 60_000,
  intervalMs: 30_000,
  maxCalls: 80,
};

export type WatchOutcome = "green" | "fix" | "ask" | "attempts" | "cost" | "pending" | "calls";

export interface WatchReport {
  readonly pr: number;
  readonly sha: string;
  readonly outcome: WatchOutcome;
  readonly checks: readonly CheckState[];
  readonly failedChecks: readonly string[];
  readonly classification: Classification | null;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly usd: number;
  readonly maxUsd: number;
  readonly calls: number;
  readonly log: string;
}

export type WatchRuntime = Pick<
  Runtime,
  "exec" | "readText" | "writeText" | "appendText" | "mkdir" | "now" | "startTimer"
>;

const sleep = (runtime: WatchRuntime, ms: number): Promise<void> =>
  new Promise((resolve) => {
    runtime.startTimer(ms, resolve);
  });

const spentSince = (runtime: WatchRuntime, root: AbsolutePath, since: string): number =>
  Object.values(readLedger(runtime, fmPaths(root)).messages)
    .filter((message) => message.at >= since)
    .reduce((total, message) => total + message.usd, 0);

const pollUntilDone = async (
  runtime: WatchRuntime,
  root: AbsolutePath,
  pr: PullRequest,
  limits: WatchLimits,
  counter: GhCounter,
): Promise<readonly CheckState[] | undefined> => {
  const started = Date.parse(runtime.now());
  for (;;) {
    const checks = readChecks(runtime, root, counter, pr.number);
    const pending = checks === undefined || checks.length === 0 || checks.some((check) => check.bucket === "pending");
    const elapsed = Date.parse(runtime.now()) - started;
    if (!pending || elapsed >= limits.timeoutMs || counter.calls >= limits.maxCalls) return checks;
    await sleep(runtime, limits.intervalMs);
  }
};

const failureOutcome = (
  classification: Classification,
  attempt: number,
  usd: number,
  limits: WatchLimits,
): WatchOutcome => {
  if (classification === "asks") return "ask";
  if (attempt >= limits.maxAttempts) return "attempts";
  return usd >= limits.maxUsd ? "cost" : "fix";
};

export const watchPullRequest = async (
  runtime: WatchRuntime,
  root: AbsolutePath,
  pr: PullRequest,
  limits: WatchLimits,
  counter: GhCounter,
): Promise<WatchReport> => {
  const state = readWatch(runtime, root, pr.number);
  const checks = (await pollUntilDone(runtime, root, pr, limits, counter)) ?? [];
  const failed = checks.filter((check) => check.bucket === "fail" || check.bucket === "cancel");
  const pending = checks.length === 0 || checks.some((check) => check.bucket === "pending");
  const shas = failed.length > 0 && !state.failed.includes(pr.sha) ? [...state.failed, pr.sha] : state.failed;
  const attempt = Math.max(0, shas.length - 1);
  const first = failed[0];
  const log = first === undefined ? "" : failedLog(runtime, root, counter, first);
  const classification = first === undefined ? null : classifyLog(log);
  const usd = spentSince(runtime, root, state.startedAt);
  const outcome: WatchOutcome =
    classification !== null
      ? failureOutcome(classification, attempt, usd, limits)
      : pending
        ? counter.calls >= limits.maxCalls
          ? "calls"
          : "pending"
        : "green";
  writeWatch(runtime, root, pr.number, { startedAt: state.startedAt, failed: shas });
  const report: WatchReport = {
    pr: pr.number,
    sha: pr.sha,
    outcome,
    checks,
    failedChecks: failed.map((check) => check.name),
    classification,
    attempt,
    maxAttempts: limits.maxAttempts,
    usd,
    maxUsd: limits.maxUsd,
    calls: counter.calls,
    log,
  };
  recordEvidence(runtime, root, pr.number, {
    sha: pr.sha,
    outcome,
    checks: checks.map((check) => ({ name: check.name, bucket: check.bucket })),
    classification,
    attempt,
  });
  return report;
};
