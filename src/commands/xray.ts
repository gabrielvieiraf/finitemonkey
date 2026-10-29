import { eventsPath, readConceptEvents } from "../conceitos/evidence.js";
import { BANDS, COVERAGES, type Xray, XRAY_FEATURE, XRAY_SCHEMA, type XrayItem } from "../conceitos/xray.js";
import { saveXray, xrayFor, xrayPath } from "../conceitos/xray-run.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { prepareGate } from "../gate/prepare.js";
import { featureMode } from "../policy/feature.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { readJsonFile } from "../task/state.js";
import type { CommandSpec } from "./types.js";

const USAGE = "finitemonkey xray [--json]";
const DECIDE_USAGE = "finitemonkey xray decide <file>:<line> --leave|--skip";

const pathsOf = (ctx: Ctx): FmPaths => fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);

const itemLine = (ctx: Ctx, item: XrayItem): string =>
  ctx.t("xray.item", {
    file: item.file,
    start: item.start,
    end: item.end,
    band: ctx.t(`xray.band.${item.band}`),
    coverage: ctx.t(`xray.coverage.${item.coverage}`),
    concepts: item.concepts.length === 0 ? "-" : item.concepts.map((entry) => entry.concept).join(", "),
    by: ctx.t(`xray.by.${item.by}`),
  });

const gridLines = (ctx: Ctx, xray: Xray): readonly string[] =>
  BANDS.flatMap((band) =>
    COVERAGES.flatMap((coverage) => {
      const count = xray.grid[band][coverage];
      return count === 0
        ? []
        : [
            ctx.t("xray.cell", {
              band: ctx.t(`xray.band.${band}`),
              coverage: ctx.t(`xray.coverage.${coverage}`),
              count,
            }),
          ];
    }),
  );

const show = (ctx: Ctx): CommandResult => {
  const paths = pathsOf(ctx);
  const mode = featureMode(ctx.runtime, paths, XRAY_FEATURE);
  if (mode === "off") return success({ schema: XRAY_SCHEMA, mode, items: [] }, [ctx.t("xray.off")]);
  const ready = prepareGate({
    runtime: ctx.runtime,
    cwd: paths.root,
    env: {},
    sessionId: undefined,
    budgetMs: 0,
    fast: true,
    noSkip: true,
  });
  if (ready.kind !== "ready") return success({ schema: XRAY_SCHEMA, mode, items: [] }, [ctx.t("xray.no_task")]);
  const { ctx: gate } = ready.prepared;
  const xray = xrayFor(ctx.runtime, paths, gate);
  saveXray(ctx.runtime, paths, gate.contract.id, gate.treeHash, xray);
  const data = { schema: XRAY_SCHEMA, mode, task: gate.contract.id, tree: gate.treeHash, ...xray };
  if (xray.items.length === 0) return success(data, [ctx.t("xray.empty", { task: gate.contract.id })]);
  return success(data, [
    ctx.t("xray.header", {
      task: gate.contract.id,
      beyond: xray.beyondWithoutCriterion,
      total: xray.items.length,
    }),
    ...gridLines(ctx, xray),
    ...xray.items.map((item) => itemLine(ctx, item)),
  ]);
};

const forget = (ctx: Ctx): CommandResult => {
  const paths = pathsOf(ctx);
  const removed = [xrayPath(paths), eventsPath(paths)].filter((path) => ctx.runtime.remove(path).ok);
  return success({ schema: XRAY_SCHEMA, removed: removed.length }, [ctx.t("xray.forgotten")]);
};

const exportAll = (ctx: Ctx): CommandResult => {
  const paths = pathsOf(ctx);
  const data = {
    schema: XRAY_SCHEMA,
    xray: readJsonFile(ctx.runtime, xrayPath(paths)) ?? null,
    events: readConceptEvents(ctx.runtime, paths),
  };
  return success(data, [JSON.stringify(data, null, 2)]);
};

const decide = (ctx: Ctx, target: string | undefined, leave: boolean, skip: boolean): CommandResult => {
  const match = /^(.+):(\d+)$/.exec(target ?? "");
  if (match === null || leave === skip)
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "error.invalid_arguments", DECIDE_USAGE, { detail: target ?? "" }),
    );
  const decision = leave ? "leave" : "skip";
  logEvent(ctx.runtime, pathsOf(ctx), "xray.decision", { file: match[1] ?? "", line: Number(match[2]), decision });
  return success({ schema: XRAY_SCHEMA, decision }, [ctx.t(`xray.decided.${decision}`, { target: target ?? "" })]);
};

export const xrayCommand: CommandSpec = {
  path: ["xray"],
  summaryKey: "command.xray.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => Promise.resolve(show(ctx)),
};

export const xrayForgetCommand: CommandSpec = {
  path: ["xray", "forget"],
  summaryKey: "command.xray_forget.summary",
  usage: "finitemonkey xray forget",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => Promise.resolve(forget(ctx)),
};

export const xrayExportCommand: CommandSpec = {
  path: ["xray", "export"],
  summaryKey: "command.xray_export.summary",
  usage: "finitemonkey xray export",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => Promise.resolve(exportAll(ctx)),
};

export const xrayDecideCommand: CommandSpec = {
  path: ["xray", "decide"],
  summaryKey: "command.xray_decide.summary",
  usage: DECIDE_USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { leave: { type: "boolean" }, skip: { type: "boolean" } },
  run: (ctx, args) =>
    Promise.resolve(decide(ctx, args.positionals[0], args.values["leave"] === true, args.values["skip"] === true)),
};
