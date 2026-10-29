import { success } from "../core/result.js";
import { collectSessions } from "../drift/collect.js";
import { warningLine } from "../drift/hook.js";
import { driftReport } from "../drift/sensor.js";
import { saveReport } from "../drift/store.js";
import { fmPaths } from "../task/paths.js";
import { inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

export const driftCommand: CommandSpec = {
  path: ["drift"],
  summaryKey: "command.drift.summary",
  usage: "finitemonkey drift [--refresh] [--json]",
  status: "ready",
  options: { refresh: { type: "boolean" } },
  run: (ctx) =>
    inGuardianRepo(ctx, (root) => {
      const report = driftReport(collectSessions(ctx.runtime, root, ctx.env));
      saveReport(ctx.runtime, fmPaths(root), report);
      const lines = report.warnings.map((warning) => warningLine(ctx.t, warning));
      return success(report, lines.length === 0 ? [ctx.t("drift.none", { days: report.days.length })] : lines);
    }),
};
