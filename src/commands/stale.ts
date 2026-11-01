import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import type { StaleReport } from "../stale/report.js";
import { staleReport } from "../stale/report.js";
import type { StaleClaim } from "../stale/resolve.js";
import { inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

const truthOf = (ctx: Ctx, claim: StaleClaim): string => {
  const truth = ctx.t(`stale.truth.${claim.truth}`, { subject: claim.subject, detail: claim.detail });
  return claim.truth === "issue_closed" && claim.detail !== ""
    ? `${truth} ${ctx.t("stale.closed_by", { prs: claim.detail })}`
    : truth;
};

export const staleClaimLine = (ctx: Ctx, claim: StaleClaim): string =>
  ctx.t("stale.line", { where: `${claim.file}:${String(claim.line)}`, says: claim.says, truth: truthOf(ctx, claim) });

const offlineLines = (ctx: Ctx, report: StaleReport): readonly string[] =>
  report.online || report.unresolvedIssues.length === 0
    ? []
    : [ctx.t("stale.offline", { count: report.unresolvedIssues.length })];

const mergeLines = (ctx: Ctx, report: StaleReport): readonly string[] => [
  ...report.unclosedIssues.map((item) =>
    ctx.t("stale.unclosed", { issue: item.issue, commits: item.commits.join(", ") }),
  ),
  ...report.emptyMilestones.map((item) => ctx.t("stale.milestone", { title: item.title, closed: item.closedIssues })),
];

export const staleLines = (ctx: Ctx, report: StaleReport): readonly string[] => [
  report.stale.length === 0
    ? ctx.t("stale.none", { claims: report.claims, docs: report.docs })
    : ctx.t("stale.head", { count: report.stale.length, claims: report.claims, docs: report.docs }),
  ...report.stale.map((claim) => staleClaimLine(ctx, claim)),
  ...report.mentions.map((item) =>
    ctx.t("stale.mention", { where: `${item.file}:${String(item.line)}`, mentions: item.mentions.join(", ") }),
  ),
  ...mergeLines(ctx, report),
  ...offlineLines(ctx, report),
];

export const staleCommand: CommandSpec = {
  path: ["stale"],
  summaryKey: "command.stale.summary",
  usage: "finitemonkey stale [--online] [--after-merge [--range <from>..<to>]] [--diff <base>] [--json]",
  status: "ready",
  options: {
    online: { type: "boolean" },
    "after-merge": { type: "boolean" },
    range: { type: "string" },
    diff: { type: "string" },
  },
  run: (ctx, args, registry) =>
    inGuardianRepo(ctx, (root) => {
      const outcome = staleReport(ctx.runtime, root, registry, {
        online: args.values["online"] === true,
        afterMerge: args.values["after-merge"] === true,
        range: stringOption(args.values, "range"),
        diff: stringOption(args.values, "diff"),
      });
      if (!outcome.ok)
        return failureFrom(ctx.t, {
          code: "stale_lookup_failed",
          messageKey: "stale.error.lookup",
          params: { detail: outcome.detail },
          fix: "gh auth status",
          exitCode: ExitCode.CheckFailed,
        });
      return success(outcome.report, staleLines(ctx, outcome.report));
    }),
};
