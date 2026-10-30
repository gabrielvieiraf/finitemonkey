import { handoffOf } from "../bridge/handoff.js";
import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { gitAt, gitRoot } from "../gate/git.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

const show = (ctx: Ctx): CommandResult => {
  const root = gitRoot(gitAt(ctx.runtime, ctx.cwd));
  if (root === undefined)
    return failureFrom(ctx.t, {
      code: "not_a_git_repo",
      messageKey: "error.not_a_git_repo",
      params: {},
      fix: "git init",
      exitCode: ExitCode.NotConfigured,
    });
  const data = handoffOf(ctx.runtime, fmPaths(root), ctx.t);
  return success(data, data.text.split("\n"));
};

export const handoffCommand: CommandSpec = {
  path: ["handoff"],
  summaryKey: "command.handoff.summary",
  usage: "finitemonkey handoff [--json]",
  status: "ready",
  run: (ctx) => Promise.resolve(show(ctx)),
};
