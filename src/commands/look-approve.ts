import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { approveRoute, latestLayouts } from "../look/approved.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export const LOOK_APPROVE_SCHEMA = "finitemonkey/look-approve@1";
const USAGE = "finitemonkey look approve <route>";

const approve = (ctx: Ctx, route: string | undefined): CommandResult => {
  if (!route?.startsWith("/")) {
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail: route ?? "" }),
    );
  }
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("look.approve.person_only", USAGE));
  const paths = fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);
  const approved = approveRoute(ctx.runtime, paths, route, latestLayouts(ctx.runtime, paths));
  if (approved.length === 0) {
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "look.approve.no_capture", "finitemonkey look", { route }),
    );
  }
  logEvent(ctx.runtime, paths, "look.approved", { route, viewports: approved.map((screen) => screen.viewport) });
  return success({ schema: LOOK_APPROVE_SCHEMA, route, viewports: approved.map((screen) => screen.viewport) }, [
    ctx.t("look.approve.done", { route, count: approved.length }),
  ]);
};

export const lookApproveCommand: CommandSpec = {
  path: ["look", "approve"],
  summaryKey: "command.look_approve.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => Promise.resolve(approve(ctx, args.positionals[0])),
};
