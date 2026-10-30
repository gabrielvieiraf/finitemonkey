import { costOf, parseSteps, recordSteps } from "../bridge/cost.js";
import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { gitAt, gitRoot } from "../gate/git.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

const withProject = (ctx: Ctx, run: (paths: FmPaths) => CommandResult): CommandResult => {
  const root = gitRoot(gitAt(ctx.runtime, ctx.cwd));
  return root === undefined
    ? failureFrom(ctx.t, {
        code: "not_a_git_repo",
        messageKey: "error.not_a_git_repo",
        params: {},
        fix: "git init",
        exitCode: ExitCode.NotConfigured,
      })
    : run(fmPaths(root));
};

const money = (usd: number): string => `$${usd.toFixed(2)}`;

const showCost = (ctx: Ctx): CommandResult =>
  withProject(ctx, (paths) => {
    const cost = costOf(ctx.runtime, paths);
    return success(cost, [
      ctx.t("mod.cost.summary", {
        task: cost.task,
        usd: money(cost.usd),
        requests: cost.requests,
        attempts: cost.attempts,
      }),
      ...cost.byArm.map((arm) => ctx.t("mod.cost.arm", { arm: arm.arm, usd: money(arm.usd), requests: arm.requests })),
    ]);
  });

const recordUsage = (ctx: Ctx, raw: string | undefined): CommandResult =>
  withProject(ctx, (paths) => {
    const recorded = recordSteps(ctx.runtime, paths, parseSteps(raw ?? "[]"));
    return success({ recorded }, []);
  });

export const modCostCommand: CommandSpec = {
  path: ["mod", "cost"],
  summaryKey: "command.mod_cost.summary",
  usage: "finitemonkey mod cost [--json]",
  status: "ready",
  run: (ctx) => Promise.resolve(showCost(ctx)),
};

export const modUsageCommand: CommandSpec = {
  path: ["mod", "usage"],
  summaryKey: "command.mod_usage.summary",
  usage: "finitemonkey mod usage --steps <json>",
  status: "ready",
  options: { steps: { type: "string" } },
  run: (ctx, args) => Promise.resolve(recordUsage(ctx, stringOption(args.values, "steps"))),
};
