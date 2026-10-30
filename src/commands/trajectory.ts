import { eventsPath, readConceptEvents } from "../conceitos/evidence.js";
import { trajectories, TRAJECTORY_FEATURE, TRAJECTORY_SCHEMA } from "../conceitos/trajectory.js";
import { chartLines, colorDepth } from "../conceitos/trajectory-ansi.js";
import { tableLines } from "../conceitos/trajectory-chart.js";
import { helpMarks } from "../conceitos/trajectory-now.js";
import type { Theme } from "../conceitos/trajectory-palette.js";
import type { TermLabels } from "../conceitos/trajectory-term.js";
import { stringOption } from "../core/args.js";
import { nowMs } from "../core/clock.js";
import type { Ctx } from "../core/context.js";
import { type CommandResult, success } from "../core/result.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { featureMode } from "../policy/feature.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

const pathsOf = (ctx: Ctx): FmPaths => fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);

const compute = (ctx: Ctx) => {
  const paths = pathsOf(ctx);
  const log = ctx.runtime.readText(paths.log);
  return trajectories(readConceptEvents(ctx.runtime, paths), helpMarks(log.ok ? log.value : ""), nowMs(ctx.runtime));
};

const termLabels = (ctx: Ctx): TermLabels => ({
  band: {
    alone: ctx.t("trajectory.band.alone"),
    proximal: ctx.t("trajectory.band.proximal"),
    unstable: ctx.t("trajectory.band.unstable"),
    blindCovered: ctx.t("trajectory.band.blind_covered"),
    blindBare: ctx.t("trajectory.band.blind_bare"),
    blind: ctx.t("trajectory.band.blind"),
    beyond: ctx.t("trajectory.band.beyond"),
  },
  gap: ctx.t("trajectory.gap"),
  line: ctx.t("trajectory.line"),
  ricochet: ctx.t("trajectory.ricochet"),
  held: ctx.t("trajectory.held"),
  hypotheses: ctx.t("trajectory.hypotheses"),
  noData: (evidence) => ctx.t("trajectory.no_data", { evidence }),
  head: (domain, from, to, evidence) => ctx.t("trajectory.head", { domain, from, to, evidence }),
});

const LIGHT_BACKGROUNDS = new Set(["7", "15"]);

export const terminalTheme = (env: Ctx["env"]): Theme =>
  LIGHT_BACKGROUNDS.has((env["COLORFGBG"] ?? "").split(";").at(-1) ?? "") ? "light" : "dark";

const show = (ctx: Ctx, domain: string | undefined, table: boolean): CommandResult => {
  const mode = featureMode(ctx.runtime, pathsOf(ctx), TRAJECTORY_FEATURE);
  if (mode === "off") return success({ schema: TRAJECTORY_SCHEMA, mode, domains: [] }, [ctx.t("trajectory.off")]);
  const all = compute(ctx).filter((item) => domain === undefined || item.domain === domain);
  const lines = table
    ? tableLines(all, {
        domain: ctx.t("trajectory.domain"),
        noData: (evidence) => ctx.t("trajectory.no_data", { evidence }),
        legend: ctx.t("trajectory.legend"),
      })
    : chartLines(all, {
        depth: colorDepth(ctx.env, ctx.io.stdout.isTTY === true),
        theme: terminalTheme(ctx.env),
        labels: termLabels(ctx),
      });
  return success({ schema: TRAJECTORY_SCHEMA, mode, domains: all }, lines);
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
  usage: "finitemonkey trajectory [--domain <domain>] [--table]",
  status: "ready",
  maxPositionals: 0,
  options: { domain: { type: "string" }, table: { type: "boolean" }, chart: { type: "boolean" } },
  run: (ctx, args) => Promise.resolve(show(ctx, stringOption(args.values, "domain"), args.values["table"] === true)),
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
