import type { Ctx } from "../core/context.js";
import { needsPersonProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { readSession } from "../gate/baseline.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { clearPause, setPause } from "../policy/pause.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export interface PauseData {
  readonly paused: boolean;
  readonly sessionId: string | null;
}

const toggle = (ctx: Ctx, off: boolean): CommandResult<PauseData> => {
  const command = off ? "finitemonkey off" : "finitemonkey on";
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("pause.error.person_only", command));
  const paths = fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);
  if (!off) {
    const ended = clearPause(ctx.runtime, paths, "terminal");
    return success({ paused: false, sessionId: ended?.sessionId ?? null }, [ctx.t("pause.on")]);
  }
  const session = readSession(ctx.runtime, paths);
  if (session === undefined) return success({ paused: false, sessionId: null }, [ctx.t("pause.no_session")]);
  setPause(ctx.runtime, paths, session.sessionId, "terminal");
  return success({ paused: true, sessionId: session.sessionId }, [ctx.t("pause.off")]);
};

export const offCommand: CommandSpec = {
  path: ["off"],
  summaryKey: "command.off.summary",
  usage: "finitemonkey off",
  status: "ready",
  run: (ctx) => Promise.resolve(toggle(ctx, true)),
};

export const onCommand: CommandSpec = {
  path: ["on"],
  summaryKey: "command.on.summary",
  usage: "finitemonkey on",
  status: "ready",
  run: (ctx) => Promise.resolve(toggle(ctx, false)),
};
