import type { Ctx } from "../core/context.js";
import { type Problem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { maskText } from "../mask/mask.js";
import { hypothesesFor } from "../signals/attempts.js";
import { signalLimits } from "../signals/limits.js";
import { appendEntry, readEntries, readIndexFile, sessionEntries, signalFiles } from "../signals/store.js";
import { fmPaths } from "../task/paths.js";
import { SIGNALS_SCHEMA } from "./signals.js";
import type { CommandSpec } from "./types.js";

const USAGE = 'finitemonkey signals hypothesis "<what changed since the last failure>"';

const invalid = (detail: string): Problem =>
  usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail });

const normalized = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();

const hypothesis = (ctx: Ctx, words: readonly string[]): CommandResult => {
  const paths = fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);
  const files = signalFiles(paths);
  const text = maskText(words.join(" ").replace(/\s+/g, " ").trim());
  const limits = signalLimits(ctx.runtime, paths.root);
  if (text.length < limits.hypothesisChars) {
    return failureFrom(ctx.t, invalid(ctx.t("signals.hypothesis.short", { count: limits.hypothesisChars })));
  }
  const entries = readEntries(ctx.runtime, files);
  const recorded = readIndexFile(ctx.runtime, files)["session"];
  const session = typeof recorded === "string" ? recorded : (entries.at(-1)?.session ?? "");
  const mine = sessionEntries(entries, session);
  const last = mine.findLast((entry) => entry.kind === "error");
  if (last?.kind !== "error") return failureFrom(ctx.t, invalid(ctx.t("signals.hypothesis.no_error")));
  if (hypothesesFor(mine, last.sig).some((before) => normalized(before) === normalized(text))) {
    return failureFrom(ctx.t, invalid(ctx.t("signals.hypothesis.repeated", { sig: last.sig })));
  }
  const first = hypothesesFor(mine, last.sig).length === 0;
  const turn = mine.filter((entry) => entry.kind === "prompt").length;
  appendEntry(
    ctx.runtime,
    files,
    { at: ctx.runtime.now(), session, turn, kind: "hypothesis", sig: last.sig, text },
    entries,
  );
  logEvent(ctx.runtime, paths, "signals.hypothesis", { sig: last.sig, session, releases: first });
  return success({ schema: SIGNALS_SCHEMA, sig: last.sig, session, releases: first }, [
    ctx.t(first ? "signals.hypothesis.recorded" : "signals.hypothesis.noted", { sig: last.sig }),
  ]);
};

export const signalsHypothesisCommand: CommandSpec = {
  path: ["signals", "hypothesis"],
  summaryKey: "command.signals_hypothesis.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 200,
  run: (ctx, args) => Promise.resolve(hypothesis(ctx, args.positionals)),
};
