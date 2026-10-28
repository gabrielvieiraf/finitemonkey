import type { GhCounter } from "../ci/watch/gh.js";
import { readPullRequest } from "../ci/watch/gh.js";
import {
  DEFAULT_LIMITS,
  type WatchLimits,
  type WatchOutcome,
  watchPullRequest,
  type WatchReport,
} from "../ci/watch/run.js";
import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { type ErrorCode, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode, type FailureExitCode } from "../exit-codes.js";
import type { MessageKey } from "../i18n/catalogs.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { projectRoot } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export const CI_WATCH_SCHEMA = "finitemonkey/ci-watch@1";
export const CI_WATCH_FEATURE = "ci-watch";
const USAGE =
  "finitemonkey ci-watch [<pr>] [--max-attempts 3] [--max-usd 5] [--timeout <minutes>] [--interval <seconds>] [--max-calls 80]";
const LOG_LINES_SHOWN = 30;

const number = (raw: string | undefined, fallback: number): number | undefined => {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

const limitsFrom = (values: Parameters<typeof stringOption>[0]): WatchLimits | undefined => {
  const maxAttempts = number(stringOption(values, "max-attempts"), DEFAULT_LIMITS.maxAttempts);
  const maxUsd = number(stringOption(values, "max-usd"), DEFAULT_LIMITS.maxUsd);
  const timeout = number(stringOption(values, "timeout"), DEFAULT_LIMITS.timeoutMs / 60_000);
  const interval = number(stringOption(values, "interval"), DEFAULT_LIMITS.intervalMs / 1000);
  const maxCalls = number(stringOption(values, "max-calls"), DEFAULT_LIMITS.maxCalls);
  if (maxAttempts === undefined || maxUsd === undefined || timeout === undefined) return undefined;
  if (interval === undefined || maxCalls === undefined) return undefined;
  return { maxAttempts, maxUsd, timeoutMs: timeout * 60_000, intervalMs: interval * 1000, maxCalls };
};

interface Ending {
  readonly code: ErrorCode;
  readonly key: MessageKey;
  readonly exitCode: FailureExitCode;
  readonly fix: string;
}

const ENDINGS: Readonly<Record<Exclude<WatchOutcome, "green">, Ending>> = {
  fix: {
    code: "ci_watch_failed",
    key: "ci.watch.fix",
    exitCode: ExitCode.CheckFailed,
    fix: "fix the failure, push, then run finitemonkey ci-watch again",
  },
  ask: {
    code: "ci_watch_failed",
    key: "ci.watch.ask",
    exitCode: ExitCode.NeedsPerson,
    fix: "show the report to the person and wait for a decision",
  },
  attempts: {
    code: "ci_watch_failed",
    key: "ci.watch.attempts",
    exitCode: ExitCode.NeedsPerson,
    fix: "stop fixing and show the report to the person",
  },
  cost: {
    code: "ci_watch_failed",
    key: "ci.watch.cost",
    exitCode: ExitCode.NeedsPerson,
    fix: "stop fixing and show the report to the person",
  },
  pending: {
    code: "ci_watch_pending",
    key: "ci.watch.pending",
    exitCode: ExitCode.CheckFailed,
    fix: "run finitemonkey ci-watch again later",
  },
  calls: {
    code: "ci_watch_pending",
    key: "ci.watch.calls",
    exitCode: ExitCode.CheckFailed,
    fix: "run finitemonkey ci-watch again later",
  },
};

const reportLines = (ctx: Ctx, report: WatchReport): readonly string[] => [
  ctx.t("ci.watch.title", { pr: report.pr, sha: report.sha.slice(0, 12), calls: report.calls }),
  ...report.checks.map((check) => `  ${check.bucket} ${check.name}`),
  ...(report.classification === null
    ? []
    : [
        ctx.t("ci.watch.failure", {
          checks: report.failedChecks.join(", "),
          classification: report.classification,
          attempt: report.attempt,
          max: report.maxAttempts,
          usd: report.usd.toFixed(2),
          maxUsd: report.maxUsd.toFixed(2),
        }),
        ...report.log
          .split("\n")
          .slice(-LOG_LINES_SHOWN)
          .map((line) => `    ${line}`),
      ]),
];

const outcomeResult = (ctx: Ctx, report: WatchReport): CommandResult<WatchReport & { readonly schema: string }> => {
  const data = { schema: CI_WATCH_SCHEMA, ...report };
  const human = reportLines(ctx, report);
  if (report.outcome === "green") return success(data, [...human, ctx.t("ci.watch.green")]);
  const ending = ENDINGS[report.outcome];
  const params = {
    attempt: report.attempt,
    max: report.maxAttempts,
    usd: report.usd.toFixed(2),
    maxUsd: report.maxUsd.toFixed(2),
  };
  return failureFrom(
    ctx.t,
    { code: ending.code, messageKey: ending.key, params, fix: ending.fix, exitCode: ending.exitCode, data },
    human,
  );
};

const run = async (ctx: Ctx, given: string | undefined, limits: WatchLimits): Promise<CommandResult> => {
  const root = projectRoot(ctx);
  const paths = fmPaths(root);
  const mode = featureMode(ctx.runtime, paths, CI_WATCH_FEATURE);
  if (mode === "off") return success({}, [ctx.t("gen.off", { feature: CI_WATCH_FEATURE })]);
  const counter: GhCounter = { calls: 0 };
  const pr = readPullRequest(ctx.runtime, root, counter, given);
  if (pr === undefined)
    return failureFrom(ctx.t, {
      code: "ci_watch_failed",
      messageKey: "ci.watch.no_pr",
      params: {},
      fix: "open the pull request first (finitemonkey pr open), and check that gh is logged in",
      exitCode: ExitCode.NotConfigured,
    });
  const report = await watchPullRequest(ctx.runtime, root, pr, limits, counter);
  if (mode === "shadow" && report.outcome !== "green") {
    recordFeatureShadow(ctx.runtime, paths, CI_WATCH_FEATURE, { pr: report.pr, outcome: report.outcome });
    return success({ schema: CI_WATCH_SCHEMA, ...report }, [
      ...reportLines(ctx, report),
      ctx.t("gen.shadow", { feature: CI_WATCH_FEATURE }),
    ]);
  }
  return outcomeResult(ctx, report);
};

export const ciWatchCommand: CommandSpec = {
  path: ["ci-watch"],
  summaryKey: "ci.command.watch",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  options: {
    "max-attempts": { type: "string" },
    "max-usd": { type: "string" },
    timeout: { type: "string" },
    interval: { type: "string" },
    "max-calls": { type: "string" },
  },
  run: (ctx, args) => {
    const limits = limitsFrom(args.values);
    if (limits === undefined)
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail: "limits" })),
      );
    return run(ctx, args.positionals[0], limits);
  },
};
