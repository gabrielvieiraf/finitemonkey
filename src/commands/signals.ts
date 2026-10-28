import type { Ctx } from "../core/context.js";
import { needsPersonProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { isPerson } from "../secrets/project.js";
import { computeIndex, type LoopIndex, thresholdsOf } from "../signals/loop-index.js";
import { contextLine } from "../signals/render.js";
import {
  MAX_THRESHOLD,
  readEntries,
  readIndexFile,
  readProfile,
  recordOf,
  sessionEntries,
  type SignalFiles,
  signalFiles,
  writeProfile,
} from "../signals/store.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export const SIGNALS_SCHEMA = "finitemonkey/signals@1";

interface Located {
  readonly paths: FmPaths;
  readonly files: SignalFiles;
}

const locate = (ctx: Ctx): Located => {
  const paths = fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);
  return { paths, files: signalFiles(paths) };
};

const lastSession = (ctx: Ctx, files: SignalFiles): string => {
  const recorded = readIndexFile(ctx.runtime, files)["session"];
  if (typeof recorded === "string") return recorded;
  return readEntries(ctx.runtime, files).at(-1)?.session ?? "";
};

const showSignals = (ctx: Ctx): CommandResult => {
  const { files } = locate(ctx);
  const profile = readProfile(ctx.runtime, files);
  const thresholds = thresholdsOf(profile);
  const session = lastSession(ctx, files);
  const entries = sessionEntries(readEntries(ctx.runtime, files), session);
  const stored = recordOf(readIndexFile(ctx.runtime, files)["index"]);
  const index: LoopIndex = computeIndex(entries, thresholds);
  const human = index.firing
    ? [contextLine(ctx.t, index, thresholds)]
    : [ctx.t("signals.show.quiet", { count: entries.length, score: index.score.toFixed(2) })];
  return success(
    { schema: SIGNALS_SCHEMA, session, signals: entries.length, threshold: profile.threshold, index, stored },
    human,
  );
};

const PERSON_FIX = "finitemonkey signals not-loop";

const notLoop = (ctx: Ctx): CommandResult => {
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("signals.error.person_only", PERSON_FIX));
  const { paths, files } = locate(ctx);
  const before = readProfile(ctx.runtime, files);
  const profile = { threshold: Math.min(before.threshold + 1, MAX_THRESHOLD), notLoop: before.notLoop + 1 };
  writeProfile(ctx.runtime, files, profile);
  logEvent(ctx.runtime, paths, "signals.not_loop", { threshold: profile.threshold, notLoop: profile.notLoop });
  return success({ schema: SIGNALS_SCHEMA, ...profile }, [
    ctx.t("signals.not_loop.recorded", { threshold: profile.threshold }),
  ]);
};

const forget = (ctx: Ctx): CommandResult => {
  const { files } = locate(ctx);
  const removed = [files.log, files.index, files.profile].filter(
    (path) => ctx.runtime.stat(path) !== undefined && ctx.runtime.remove(path).ok,
  );
  return success({ schema: SIGNALS_SCHEMA, removed: removed.length }, [ctx.t("signals.forget.done")]);
};

export const signalsCommand: CommandSpec = {
  path: ["signals"],
  summaryKey: "command.signals.summary",
  usage: "finitemonkey signals",
  status: "ready",
  run: (ctx) => Promise.resolve(showSignals(ctx)),
};

export const signalsNotLoopCommand: CommandSpec = {
  path: ["signals", "not-loop"],
  summaryKey: "command.signals_not_loop.summary",
  usage: PERSON_FIX,
  status: "ready",
  run: (ctx) => Promise.resolve(notLoop(ctx)),
};

export const signalsForgetCommand: CommandSpec = {
  path: ["signals", "forget"],
  summaryKey: "command.signals_forget.summary",
  usage: "finitemonkey signals forget",
  status: "ready",
  run: (ctx) => Promise.resolve(forget(ctx)),
};
