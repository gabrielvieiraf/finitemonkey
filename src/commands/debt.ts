import { type CommandResult, failureFrom, success } from "../core/result.js";
import { listDebt } from "../debt/list.js";
import { fmPaths } from "../task/paths.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const DEBT_SCHEMA = "finitemonkey/debt@1";

export const debtCommand: CommandSpec = {
  path: ["debt"],
  summaryKey: "command.debt.summary",
  usage: "finitemonkey debt",
  status: "ready",
  run: (ctx): Promise<CommandResult> => {
    const repo = repoOf(ctx);
    if (repo === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const items = listDebt(ctx.runtime, fmPaths(repo.root));
    const lines = items.map((item) =>
      ctx.t("debt.row", {
        state: item.state,
        what: item.what,
        task: item.task ?? "-",
        where: item.where ?? "-",
        detail: item.detail === "" ? "-" : item.detail,
      }),
    );
    return Promise.resolve(
      success({ schema: DEBT_SCHEMA, items }, [ctx.t("debt.title", { count: items.length }), ...lines]),
    );
  },
};
