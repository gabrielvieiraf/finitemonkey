import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { isPerson } from "../secrets/project.js";
import { fourthOutcomes } from "../signals/attempts.js";
import { computeIndex, type LoopIndex, thresholdsOf } from "../signals/loop-index.js";
import { contextLine } from "../signals/render.js";
import {
  appendEntry,
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
  const fourth = fourthOutcomes(readEntries(ctx.runtime, files));
  const human = [
    index.firing
      ? contextLine(ctx.t, index, thresholds)
      : ctx.t("signals.show.quiet", { count: entries.length, score: index.score.toFixed(2) }),
    ...(fourth.fired === 0 ? [] : [ctx.t("signals.show.fourth", { count: fourth.fired, solved: fourth.solved })]),
  ];
  return success(
    { schema: SIGNALS_SCHEMA, session, signals: entries.length, threshold: profile.threshold, index, stored, fourth },
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

const RELEASE_USAGE = "finitemonkey signals release <signature>";

const release = (ctx: Ctx, sig: string): CommandResult => {
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("signals.error.person_only", RELEASE_USAGE));
  if (!/^[0-9a-f]{4}$/.test(sig)) {
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "error.invalid_arguments", RELEASE_USAGE, { detail: sig }),
    );
  }
  const { paths, files } = locate(ctx);
  const session = lastSession(ctx, files);
  const entries = readEntries(ctx.runtime, files);
  const turn = entries.filter((entry) => entry.session === session && entry.kind === "prompt").length;
  appendEntry(ctx.runtime, files, { at: ctx.runtime.now(), session, turn, kind: "release", sig }, entries);
  logEvent(ctx.runtime, paths, "signals.release", { sig, session });
  return success({ schema: SIGNALS_SCHEMA, sig, session }, [ctx.t("signals.release.done", { sig })]);
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

export const signalsReleaseCommand: CommandSpec = {
  path: ["signals", "release"],
  summaryKey: "command.signals_release.summary",
  usage: RELEASE_USAGE,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => Promise.resolve(release(ctx, (args.positionals[0] ?? "").toLowerCase())),
};

export const signalsForgetCommand: CommandSpec = {
  path: ["signals", "forget"],
  summaryKey: "command.signals_forget.summary",
  usage: "finitemonkey signals forget",
  status: "ready",
  run: (ctx) => Promise.resolve(forget(ctx)),
};
