import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { failureFrom, success } from "../core/result.js";
import { DEFAULT_SINCE, sinceIso } from "../recap/period.js";
import { buildRecap, type RecapReport } from "../recap/recap.js";
import { fmPaths } from "../task/paths.js";
import { inGuardianRepo } from "./guardian.js";
import { staleClaimLine } from "./stale.js";
import type { CommandSpec } from "./types.js";

const USAGE = "finitemonkey recap [--since <7d|24h|2w|YYYY-MM-DD>] [--json]";

const shippedLines = (ctx: Ctx, report: RecapReport): readonly string[] =>
  report.shipped.map((item) =>
    ctx.t("recap.shipped", {
      sha: item.sha,
      type: item.type,
      subject: item.subject,
      features:
        item.features.length === 0
          ? ""
          : ` [${item.features.map((feature) => `${feature.id}: ${feature.mode}`).join(", ")}]`,
    }),
  );

export const recapLines = (ctx: Ctx, report: RecapReport): readonly string[] => [
  ctx.t("recap.head", {
    since: report.since.slice(0, 10),
    commits: report.commits,
    tasks: report.tasksFinished.length,
    shipped: report.shipped.length,
  }),
  ...report.tasksFinished.map((item) => ctx.t("recap.task", { task: item.task, at: item.at.slice(0, 10) })),
  ...shippedLines(ctx, report),
  ...report.decisions.map((item) =>
    ctx.t("recap.decision", { task: item.task, at: item.at.slice(0, 10), changes: item.changes.join(", ") }),
  ),
  ...(report.activeTask === null ? [] : [ctx.t("recap.active", { task: report.activeTask })]),
  ...(report.inShadow.length === 0 ? [] : [ctx.t("recap.shadow", { features: report.inShadow.join(", ") })]),
  ...(report.staleDocs.length === 0
    ? [ctx.t("recap.docs_ok")]
    : [ctx.t("recap.docs_stale", { count: report.staleDocs.length })]),
  ...report.staleDocs.map((claim) => staleClaimLine(ctx, claim)),
];

export const recapCommand: CommandSpec = {
  path: ["recap"],
  summaryKey: "command.recap.summary",
  usage: USAGE,
  status: "ready",
  options: { since: { type: "string" } },
  run: (ctx, args, registry) =>
    inGuardianRepo(ctx, (root) => {
      const raw = stringOption(args.values, "since") ?? DEFAULT_SINCE;
      const since = sinceIso(raw, ctx.runtime.now());
      if (since === undefined)
        return failureFrom(ctx.t, usageProblem("invalid_arguments", "recap.error.since", USAGE, { value: raw }));
      const report = buildRecap(ctx.runtime, root, fmPaths(root), registry, since);
      return success(report, recapLines(ctx, report));
    }),
};
