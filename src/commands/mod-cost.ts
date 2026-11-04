import { billingOf } from "../bridge/billing.js";
import { costOf, type CostSummary, parseSteps, recordSteps } from "../bridge/cost.js";
import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { gitAt, gitRoot } from "../gate/git.js";
import { spentToday } from "../provider/ledger.js";
import { maxUsdPerDay } from "../provider/store.js";
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

const cappedLine = (ctx: Ctx, paths: FmPaths): readonly string[] => {
  const spent = spentToday(ctx.runtime, paths);
  const cap = maxUsdPerDay(ctx.runtime, paths);
  return spent > 0 && spent >= cap ? [ctx.t("provider.capped", { cap: money(cap) })] : [];
};

const tokenLines = (ctx: Ctx, cost: CostSummary, paths: FmPaths): readonly string[] => [
  ctx.t("mod.cost.tokens", {
    task: cost.task,
    tokens: new Intl.NumberFormat(ctx.lang).format(cost.tokens.total),
    requests: cost.requests,
    attempts: cost.attempts,
  }),
  ...cappedLine(ctx, paths),
];

const showCost = (ctx: Ctx): CommandResult =>
  withProject(ctx, (paths) => {
    const cost = costOf(ctx.runtime, paths);
    const billing = billingOf(ctx.runtime, paths.root, ctx.env);
    if (billing === "subscription") return success({ ...cost, billing }, tokenLines(ctx, cost, paths));
    return success({ ...cost, billing }, [
      ctx.t("mod.cost.summary", {
        task: cost.task,
        usd: money(cost.usd),
        requests: cost.requests,
        attempts: cost.attempts,
      }),
      ...cost.byArm.map((arm) => ctx.t("mod.cost.arm", { arm: arm.arm, usd: money(arm.usd), requests: arm.requests })),
      ...cost.byKind.map((kind) =>
        ctx.t("mod.cost.kind", {
          kind: kind.kind,
          usd: money(kind.usd),
          calls: kind.calls,
          tokens: kind.tokens,
          seconds: Math.round(kind.durationMs / 1000),
        }),
      ),
      ...cappedLine(ctx, paths),
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
