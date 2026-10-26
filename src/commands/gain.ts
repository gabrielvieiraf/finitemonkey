import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { type GainCounts, type GainReport, gainReport } from "../gain/gain.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import type { MessageKey } from "../i18n/catalogs.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

const DEFAULT_DAYS = 30;

const trend = (ctx: Ctx, now: number, before: number): string =>
  now === before ? "" : ` (${ctx.t(now > before ? "gain.up" : "gain.down", { delta: Math.abs(now - before) })})`;

const ROWS: readonly { readonly key: MessageKey; readonly pick: (counts: GainCounts) => number }[] = [
  { key: "gain.row.blocks", pick: (counts) => counts.blocks },
  { key: "gain.row.saves", pick: (counts) => counts.saves },
  { key: "gain.row.false_positives", pick: (counts) => counts.falsePositives },
  { key: "gain.row.gate_runs", pick: (counts) => counts.gateRuns },
  { key: "gain.row.gate_failed", pick: (counts) => counts.gateFailed },
  { key: "gain.row.gate_unverified", pick: (counts) => counts.gateUnverified },
];

const linesOf = (ctx: Ctx, report: GainReport): readonly string[] => [
  ctx.t("gain.title", { days: report.days }),
  ...ROWS.map(
    ({ key, pick }) =>
      `  ${ctx.t(key, { count: pick(report.current) })}${trend(ctx, pick(report.current), pick(report.previous))}`,
  ),
  `  ${ctx.t("gain.row.gate_time", { minutes: Math.round(report.current.gateMs / 60_000) })}`,
  ctx.t("gain.footer"),
];

const runGain = (ctx: Ctx, rawDays: string | undefined): CommandResult<GainReport> => {
  const days = rawDays === undefined ? DEFAULT_DAYS : Number.parseInt(rawDays, 10);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "error.invalid_arguments", "finitemonkey gain --days 30", {
        detail: "--days 1-365",
      }),
    );
  }
  const report = gainReport(ctx.runtime, fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd), days);
  return success(report, linesOf(ctx, report));
};

export const gainCommand: CommandSpec = {
  path: ["gain"],
  summaryKey: "command.gain.summary",
  usage: "finitemonkey gain [--days 1-365]",
  status: "ready",
  options: { days: { type: "string" } },
  run: (ctx, args) => Promise.resolve(runGain(ctx, stringOption(args.values, "days"))),
};
