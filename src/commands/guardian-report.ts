import { success } from "../core/result.js";
import { openHighImpact, readAssumptions } from "../guardian/assumptions.js";
import { readGoals } from "../guardian/goals.js";
import { renderReport, showable } from "../guardian/report.js";
import { activeTask, taskList } from "../guardian/tasks.js";
import { goalConflicts, growthReports } from "../guardian/triggers.js";
import { triageNow } from "../judge/triage-raise.js";
import { fmPaths } from "../task/paths.js";
import { inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

export const GUARDIAN_REPORT_SCHEMA = "finitemonkey/guardian-report@1";

export const guardianReportCommand: CommandSpec = {
  path: ["guardian", "report"],
  summaryKey: "command.guardian_report.summary",
  usage: "finitemonkey guardian report",
  status: "ready",
  run: (ctx) =>
    inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      const task = activeTask(ctx.runtime, paths);
      const triage = triageNow(ctx.runtime, paths);
      const triageLines = triage === null || triage.open === 0 ? [] : [ctx.t("guardian.report.triage", { ...triage })];
      if (task === undefined)
        return success(
          { schema: GUARDIAN_REPORT_SCHEMA, reports: [], triage },
          triageLines.length === 0 ? [ctx.t("guardian.report.none")] : triageLines,
        );
      const text = ctx.runtime.readText(paths.task(task.contract.id));
      const ids = text.ok ? taskList(text.value, "assumptions") : [];
      const base = {
        t: ctx.t,
        task,
        goals: readGoals(ctx.runtime, root),
        open: openHighImpact(readAssumptions(ctx.runtime, paths), ids),
      };
      const reports = [...goalConflicts(base), ...growthReports(base)].filter(showable);
      const lines = [...reports.map((report) => renderReport(ctx.t, report)), ...triageLines];
      return success(
        { schema: GUARDIAN_REPORT_SCHEMA, reports, triage },
        lines.length === 0 ? [ctx.t("guardian.report.none")] : lines,
      );
    }),
};
