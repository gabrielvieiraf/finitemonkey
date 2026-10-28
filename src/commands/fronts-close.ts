import { accept } from "../core/parsed.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { checkReport, reportSummary } from "../fronts/report-gate.js";
import { readFronts, updateFronts, withFront } from "../fronts/state.js";
import { mainRoot } from "./fronts.js";
import type { CommandSpec } from "./types.js";

export const FRONT_CLOSE_SCHEMA = "finitemonkey/fronts-close@1";

export const frontsCloseCommand: CommandSpec = {
  path: ["fronts", "close"],
  summaryKey: "fronts.command.close",
  usage: "finitemonkey fronts close <front> [--json]",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args): Promise<CommandResult> => {
    const root = mainRoot(ctx);
    const id = args.positionals[0] ?? "";
    const state = readFronts(ctx.runtime, root);
    const front = state.ok ? state.value.fronts.find((item) => item.id === id) : undefined;
    if (front === undefined) {
      return Promise.resolve(
        failureFrom(
          ctx.t,
          usageProblem("fronts_failed", "fronts.error.unknown_front", "finitemonkey fronts status", { id }),
        ),
      );
    }
    const check = checkReport(ctx.runtime, root, front);
    const data = { schema: FRONT_CLOSE_SCHEMA, front: id, problems: check.problems, report: check.report ?? null };
    if (check.problems.length > 0) {
      return Promise.resolve({
        ...failureFrom(ctx.t, {
          ...usageProblem("front_report_invalid", "fronts.error.report", "finitemonkey fronts status", {
            front: id,
            problems: check.problems.join("; "),
          }),
          exitCode: ExitCode.CheckFailed,
        }),
        data,
      });
    }
    updateFronts(ctx.runtime, root, (current) =>
      accept({
        state: withFront(current, id, (item) => ({
          ...item,
          status: "verified",
          lastReport: check.file ?? item.lastReport,
        })),
        result: undefined,
      }),
    );
    return Promise.resolve(success(data, [ctx.t("fronts.close.done", { summary: reportSummary(check) })]));
  },
};
