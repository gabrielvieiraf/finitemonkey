import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { maskText } from "../mask/mask.js";
import { signalLimits } from "../signals/limits.js";
import { appendEntry, readEntries, readIndexFile, sessionEntries, signalFiles } from "../signals/store.js";
import { fmPaths } from "../task/paths.js";
import { SIGNALS_SCHEMA } from "./signals.js";
import type { CommandSpec } from "./types.js";

const USAGE = "finitemonkey signals locate <file>:<line> <reason>";
const PLACE = /^(.+):(\d+)$/;

const locate = (ctx: Ctx, words: readonly string[]): CommandResult => {
  const paths = fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);
  const limits = signalLimits(ctx.runtime, paths.root);
  const place = PLACE.exec(words[0] ?? "");
  const reason = maskText(words.slice(1).join(" ").replace(/\s+/g, " ").trim());
  const file = place?.[1];
  const line = Number(place?.[2] ?? "0");
  if (file === undefined || line < 1 || reason.length < limits.hypothesisChars) {
    const detail = ctx.t("signals.locate.invalid", { count: limits.hypothesisChars });
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail }));
  }
  const files = signalFiles(paths);
  const entries = readEntries(ctx.runtime, files);
  const recorded = readIndexFile(ctx.runtime, files)["session"];
  const session = typeof recorded === "string" ? recorded : (entries.at(-1)?.session ?? "");
  const turn = sessionEntries(entries, session).filter((entry) => entry.kind === "prompt").length;
  appendEntry(
    ctx.runtime,
    files,
    { at: ctx.runtime.now(), session, turn, kind: "located", file, line, reason },
    entries,
  );
  logEvent(ctx.runtime, paths, "signals.located", { file, line, session });
  return success({ schema: SIGNALS_SCHEMA, file, line, session }, [ctx.t("signals.locate.recorded", { file, line })]);
};

export const signalsLocateCommand: CommandSpec = {
  path: ["signals", "locate"],
  summaryKey: "command.signals_locate.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 200,
  run: (ctx, args) => Promise.resolve(locate(ctx, args.positionals)),
};
