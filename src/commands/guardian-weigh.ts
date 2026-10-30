import { stringOption } from "../core/args.js";
import { success } from "../core/result.js";
import { renderReport } from "../guardian/report.js";
import { scanChange } from "../guardian/scan.js";
import { fmPaths } from "../task/paths.js";
import { inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

export const GUARDIAN_WEIGH_SCHEMA = "finitemonkey/guardian-weigh@1";

export const guardianWeighCommand: CommandSpec = {
  path: ["guardian", "weigh"],
  summaryKey: "command.guardian_weigh.summary",
  usage: "finitemonkey guardian weigh [--base <ref>]",
  status: "ready",
  options: { base: { type: "string" } },
  run: (ctx, args) =>
    inGuardianRepo(ctx, (root) => {
      const scanned = scanChange(ctx.runtime, ctx.t, fmPaths(root), stringOption(args.values, "base") ?? "HEAD");
      const report = scanned.reports.find((item) => item.feature === "proportionality")?.report;
      const summary = ctx.t("guardian.weigh.summary", {
        tokens: scanned.proportion.tokens,
        budget: scanned.proportion.budget,
        undo: scanned.weight.reversibility,
        verdict: scanned.proportion.reason ?? scanned.proportion.verdict,
      });
      return success(
        {
          schema: GUARDIAN_WEIGH_SCHEMA,
          weight: scanned.weight,
          proportion: scanned.proportion,
          report: report ?? null,
        },
        [summary, ...(report === undefined ? [] : [renderReport(ctx.t, report)])],
      );
    }),
};
