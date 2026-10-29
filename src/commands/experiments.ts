import { success } from "../core/result.js";
import type { Translate } from "../i18n/translate.js";
import { type SourceReport, sourceReports, writeDemotions } from "../knowledge/arms.js";
import { fmPaths } from "../task/paths.js";
import { inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

export const EXPERIMENTS_SCHEMA = "finitemonkey/experiments-report@1";

const fixed = (value: number | null): string => (value === null ? "-" : value.toFixed(2));

const reportLine = (t: Translate, report: SourceReport): string =>
  t(report.demoted ? "knowledge.arms.row_demoted" : "knowledge.arms.row", {
    source: report.source,
    effect: fixed(report.effect),
    low: fixed(report.interval?.[0] ?? null),
    high: fixed(report.interval?.[1] ?? null),
    cost: fixed(report.cost),
    active: report.active.tasks,
    off: report.off.tasks,
  });

export const experimentsReportCommand: CommandSpec = {
  path: ["experiments", "report"],
  summaryKey: "command.experiments_report.summary",
  usage: "finitemonkey experiments report",
  status: "ready",
  run: (ctx) =>
    inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      const reports = sourceReports(ctx.runtime, paths);
      const demoted = writeDemotions(ctx.runtime, paths, reports);
      return success({ schema: EXPERIMENTS_SCHEMA, sources: reports, demoted }, [
        ...(reports.length === 0 ? [ctx.t("knowledge.arms.none")] : reports.map((report) => reportLine(ctx.t, report))),
        ...demoted.map((source) => ctx.t("knowledge.arms.demoted", { source })),
      ]);
    }),
};
