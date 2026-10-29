import type { Ctx } from "../core/context.js";
import { type CommandResult, success } from "../core/result.js";
import { boardOf } from "../fronts/board.js";
import type { CommandSpec } from "./types.js";

const show = (ctx: Ctx): CommandResult => {
  const board = boardOf(ctx.runtime, ctx.cwd);
  return success(board, [
    ...board.rows.map((row) =>
      ctx.t("fronts.board.row", {
        branch: row.branch ?? "-",
        gate: row.gate,
        contract: row.contract ?? "-",
        waiting: row.waiting ? ctx.t("fronts.board.waiting") : "",
      }),
    ),
    ...board.collisions.map((item) =>
      ctx.t("fronts.board.collision", { file: item.file, branches: item.branches.join(", ") }),
    ),
  ]);
};

export const frontsBoardCommand: CommandSpec = {
  path: ["fronts", "board"],
  summaryKey: "command.fronts_board.summary",
  usage: "finitemonkey fronts board [--json]",
  status: "ready",
  run: (ctx) => Promise.resolve(show(ctx)),
};
