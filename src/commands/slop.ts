import { join } from "node:path";

import { stringOption } from "../core/args.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { isPerson, projectRoot } from "../secrets/project.js";
import {
  detectorRates,
  type Dismissal,
  fingerprintOf,
  readSlopStore,
  REVIEW_RATE,
  writeSlopStore,
} from "../slop/store.js";
import { FILE_DETECTORS, isDetector, SLOP_DETECTORS } from "../slop/types.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export const SLOP_STATS_SCHEMA = "finitemonkey/slop-stats@1";
export const SLOP_DISMISS_SCHEMA = "finitemonkey/slop-dismiss@1";
const DISMISS_USAGE = `finitemonkey slop dismiss <${SLOP_DETECTORS.join("|")}> <file>:<line> --reason <why>`;

const invalid = (ctx: Ctx, detail: string): CommandResult =>
  failureFrom(ctx.t, usageProblem("invalid_arguments", "error.invalid_arguments", DISMISS_USAGE, { detail }));

const location = (raw: string): { readonly file: string; readonly line: number } | undefined => {
  const match = /^(.+):(\d+)$/.exec(raw);
  const line = Number(match?.[2] ?? "");
  return match === null || !Number.isInteger(line) || line < 1 ? undefined : { file: match[1] ?? "", line };
};

const dismiss = (ctx: Ctx, args: readonly string[], reason: string): CommandResult => {
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("slop.error.person_only", DISMISS_USAGE));
  const [detector = "", where = ""] = args;
  if (!isDetector(detector)) return invalid(ctx, detector === "" ? "<detector>" : detector);
  const spot = location(where);
  if (spot === undefined) return invalid(ctx, where === "" ? "<file>:<line>" : where);
  if (reason.trim() === "") return invalid(ctx, "--reason");
  const root = projectRoot(ctx);
  const text = ctx.runtime.readText(toAbsolutePath(join(root, spot.file)));
  const lineText = text.ok ? text.value.split("\n")[spot.line - 1] : undefined;
  const subject = FILE_DETECTORS.has(detector) ? spot.file : (lineText ?? spot.file);
  const paths = fmPaths(root);
  const store = readSlopStore(ctx.runtime, paths);
  const entry: Dismissal = {
    detector,
    fingerprint: fingerprintOf(detector, spot.file, subject),
    file: spot.file,
    line: spot.line,
    reason,
    at: ctx.runtime.now(),
  };
  writeSlopStore(ctx.runtime, paths, { ...store, dismissed: [...store.dismissed, entry] });
  logEvent(ctx.runtime, paths, "slop.dismissed", { detector, file: spot.file, line: spot.line });
  return success({ schema: SLOP_DISMISS_SCHEMA, ...entry }, [
    ctx.t("slop.dismissed", { detector, file: spot.file, line: spot.line }),
  ]);
};

export const slopDismissCommand: CommandSpec = {
  path: ["slop", "dismiss"],
  summaryKey: "command.slop_dismiss.summary",
  usage: DISMISS_USAGE,
  status: "ready",
  maxPositionals: 2,
  options: { reason: { type: "string" } },
  run: (ctx, args) => Promise.resolve(dismiss(ctx, args.positionals, stringOption(args.values, "reason") ?? "")),
};

export const slopStatsCommand: CommandSpec = {
  path: ["slop", "stats"],
  summaryKey: "command.slop_stats.summary",
  usage: "finitemonkey slop stats",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => {
    const rates = detectorRates(readSlopStore(ctx.runtime, fmPaths(projectRoot(ctx))));
    const lines = rates
      .filter((rate) => rate.hits > 0)
      .map((rate) =>
        ctx.t(rate.review ? "slop.stats.review" : "slop.stats.row", {
          detector: rate.detector,
          hits: rate.hits,
          dismissed: rate.dismissed,
          percent: Math.round(rate.rate * 100),
          max: Math.round(REVIEW_RATE * 100),
        }),
      );
    return Promise.resolve(
      success(
        { schema: SLOP_STATS_SCHEMA, detectors: rates },
        lines.length === 0 ? [ctx.t("slop.stats.empty")] : lines,
      ),
    );
  },
};
