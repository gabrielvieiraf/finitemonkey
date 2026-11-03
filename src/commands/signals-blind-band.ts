import type { Ctx } from "../core/context.js";
import { type CommandResult, success } from "../core/result.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { blindBand, type BlindBandReport, openBlindBand, type OpenBlindBandReport } from "../signals/blind-band.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export type BlindBandData = BlindBandReport;
export type OpenBlindBandData = OpenBlindBandReport;

const percent = (value: number): string => `${String(Math.round(value * 100))}%`;

const report = (ctx: Ctx, fields: boolean): CommandResult => {
  const paths = fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);
  const log = ctx.runtime.readText(paths.log);
  const text = log.ok ? log.value : "";
  const data: BlindBandData | OpenBlindBandData = fields
    ? openBlindBand(ctx.runtime, paths, text)
    : blindBand(ctx.runtime, paths, text);
  const human =
    data.rows.length === 0
      ? [ctx.t("blind_band.empty")]
      : [
          ctx.t("blind_band.total", {
            index: percent(data.total.index),
            without: data.total.withoutCriterion,
            helps: data.total.helps,
          }),
          ...data.rows.map((row) =>
            ctx.t("blind_band.row", {
              week: row.week,
              domain: row.domain,
              index: percent(row.index),
              without: row.withoutCriterion,
              helps: row.helps,
              concepts: row.conceptsMoved,
            }),
          ),
        ];
  return success(data, human);
};

export const signalsBlindBandCommand: CommandSpec = {
  path: ["signals", "blind-band"],
  summaryKey: "command.signals_blind_band.summary",
  usage: "finitemonkey signals blind-band [--fields] [--json]",
  status: "ready",
  options: { fields: { type: "boolean" } },
  maxPositionals: 0,
  run: (ctx, args) => Promise.resolve(report(ctx, args.values["fields"] === true)),
};
