import { eventsPath, readConceptEvents } from "../conceitos/evidence.js";
import { type HelpMark, trajectories, TRAJECTORY_FEATURE, TRAJECTORY_SCHEMA } from "../conceitos/trajectory.js";
import { blockLines, tableLines } from "../conceitos/trajectory-chart.js";
import { stringOption } from "../core/args.js";
import { nowMs } from "../core/clock.js";
import type { Ctx } from "../core/context.js";
import { parseJsonObject } from "../core/parsed.js";
import { type CommandResult, success } from "../core/result.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { featureMode } from "../policy/feature.js";
import { HORIZON_EVENT } from "../signals/blind-band.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

const pathsOf = (ctx: Ctx): FmPaths => fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);

export const helpMarks = (log: string): readonly HelpMark[] =>
  log.split("\n").flatMap((line) => {
    if (!line.includes(HORIZON_EVENT)) return [];
    const parsed = parseJsonObject(line);
    if (!parsed.ok || parsed.value["event"] !== HORIZON_EVENT) return [];
    const { at, domain, criterion } = parsed.value;
    return typeof at === "string" && typeof domain === "string" && typeof criterion === "string"
      ? [{ at, domain, criterion }]
      : [];
  });

const compute = (ctx: Ctx) => {
  const paths = pathsOf(ctx);
  const log = ctx.runtime.readText(paths.log);
  return trajectories(readConceptEvents(ctx.runtime, paths), helpMarks(log.ok ? log.value : ""), nowMs(ctx.runtime));
};

const show = (ctx: Ctx, domain: string | undefined, chart: boolean): CommandResult => {
  const mode = featureMode(ctx.runtime, pathsOf(ctx), TRAJECTORY_FEATURE);
  if (mode === "off") return success({ schema: TRAJECTORY_SCHEMA, mode, domains: [] }, [ctx.t("trajectory.off")]);
  const all = compute(ctx).filter((item) => domain === undefined || item.domain === domain);
  const table = tableLines(all, {
    domain: ctx.t("trajectory.domain"),
    noData: (evidence) => ctx.t("trajectory.no_data", { evidence }),
    legend: ctx.t("trajectory.legend"),
  });
  const charts = chart ? all.flatMap((item) => ["", ...blockLines(item)]) : [];
  return success({ schema: TRAJECTORY_SCHEMA, mode, domains: all }, [...table, ...charts]);
};

const forget = (ctx: Ctx): CommandResult => {
  const removed = ctx.runtime.remove(eventsPath(pathsOf(ctx))).ok;
  return success({ schema: TRAJECTORY_SCHEMA, removed: removed ? 1 : 0 }, [ctx.t("trajectory.forgotten")]);
};

const exportAll = (ctx: Ctx): CommandResult => {
  const data = {
    schema: TRAJECTORY_SCHEMA,
    domains: compute(ctx),
    events: readConceptEvents(ctx.runtime, pathsOf(ctx)),
  };
  return success(data, [JSON.stringify(data, null, 2)]);
};

export const trajectoryCommand: CommandSpec = {
  path: ["trajectory"],
  summaryKey: "command.trajectory.summary",
  usage: "finitemonkey trajectory [--domain <domain>] [--chart]",
  status: "ready",
  maxPositionals: 0,
  options: { domain: { type: "string" }, chart: { type: "boolean" } },
  run: (ctx, args) => Promise.resolve(show(ctx, stringOption(args.values, "domain"), args.values["chart"] === true)),
};

export const trajectoryForgetCommand: CommandSpec = {
  path: ["trajectory", "forget"],
  summaryKey: "command.trajectory_forget.summary",
  usage: "finitemonkey trajectory forget",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => Promise.resolve(forget(ctx)),
};

export const trajectoryExportCommand: CommandSpec = {
  path: ["trajectory", "export"],
  summaryKey: "command.trajectory_export.summary",
  usage: "finitemonkey trajectory export",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => Promise.resolve(exportAll(ctx)),
};
