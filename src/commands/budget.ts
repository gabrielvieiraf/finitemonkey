import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { money } from "../spend/budget.js";
import { ingest } from "../spend/ingest.js";
import { PRICE_SOURCE } from "../spend/prices.js";
import { reconcile, RECONCILE_FILE, RECONCILE_TOOL } from "../spend/reconcile.js";
import { budgetStatus } from "../spend/status.js";
import { FM_DIR, fmPaths } from "../task/paths.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const BUDGET_SCHEMA = "finitemonkey/budget@1";

const inRepo = (ctx: Ctx, run: (paths: ReturnType<typeof fmPaths>) => CommandResult): Promise<CommandResult> => {
  const repo = repoOf(ctx);
  return Promise.resolve(repo === undefined ? failureFrom(ctx.t, notRepository(ctx.cwd)) : run(fmPaths(repo.root)));
};

export const budgetCommand: CommandSpec = {
  path: ["budget"],
  summaryKey: "command.budget.summary",
  usage: "finitemonkey budget",
  status: "ready",
  run: (ctx) =>
    inRepo(ctx, (paths) => {
      const status = budgetStatus({ runtime: ctx.runtime, paths, env: ctx.env, sessionId: undefined, refresh: true });
      const lines = status.spends.map((item) =>
        ctx.t("budget.row", {
          scope: item.scope,
          spent: money(item.spent),
          limit: item.limit === undefined ? "-" : money(item.limit),
          level: item.level,
        }),
      );
      return success({ schema: BUDGET_SCHEMA, ...status, priceSource: PRICE_SOURCE }, [
        ctx.t("budget.title"),
        ...lines,
        ctx.t(status.configured ? "budget.estimate" : "budget.unconfigured", { source: PRICE_SOURCE }),
        ...(status.released ? [ctx.t("budget.released_line")] : []),
      ]);
    }),
};

export const costReconcileCommand: CommandSpec = {
  path: ["cost", "reconcile"],
  summaryKey: "command.cost_reconcile.summary",
  usage: "finitemonkey cost reconcile",
  status: "ready",
  run: (ctx) =>
    inRepo(ctx, (paths) => {
      const ledger = ingest({ runtime: ctx.runtime, paths, env: ctx.env });
      const record = reconcile(ctx.runtime, paths, ledger);
      if (record === undefined)
        return failureFrom(ctx.t, {
          code: "reconcile_unavailable",
          messageKey: "budget.reconcile.missing",
          params: { tool: RECONCILE_TOOL },
          fix: `install ${RECONCILE_TOOL} locally, then run finitemonkey cost reconcile again`,
          exitCode: ExitCode.NotConfigured,
        });
      return success({ schema: BUDGET_SCHEMA, file: `${FM_DIR}/${RECONCILE_FILE}`, ...record }, [
        ctx.t("budget.reconcile.done", { tool: record.tool, file: `${FM_DIR}/${RECONCILE_FILE}` }),
        ...record.days.map((day) => `  ${day.date}  ${money(day.ours)}  ${money(day.theirs)}  ${money(day.diff)}`),
      ]);
    }),
};
