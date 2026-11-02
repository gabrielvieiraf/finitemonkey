import { stringOption } from "../core/args.js";
import { success } from "../core/result.js";
import { noteContextAsked } from "../guardian/context-answer.js";
import { findExisting } from "../guardian/existing.js";
import { recordScan } from "../guardian/pending.js";
import { renderReport } from "../guardian/report.js";
import { reuseReport } from "../guardian/reuse-report.js";
import { scanChange } from "../guardian/scan.js";
import { activeTask } from "../guardian/tasks.js";
import { fmPaths } from "../task/paths.js";
import { inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

export const GUARDIAN_REUSE_SCHEMA = "finitemonkey/guardian-reuse@1";
export const GUARDIAN_SCAN_SCHEMA = "finitemonkey/guardian-scan@1";

export const guardianReuseCommand: CommandSpec = {
  path: ["guardian", "reuse"],
  summaryKey: "command.guardian_reuse.summary",
  usage: "finitemonkey guardian reuse [--base <ref>]",
  status: "ready",
  options: { base: { type: "string" } },
  run: (ctx, args) =>
    inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      const matches = findExisting(ctx.runtime, paths, stringOption(args.values, "base") ?? "HEAD");
      const goal = activeTask(ctx.runtime, paths)?.contract.goal ?? "";
      const reports = matches.map((match) => reuseReport(ctx.t, match, goal));
      return success(
        { schema: GUARDIAN_REUSE_SCHEMA, matches, reports },
        reports.map((report) => renderReport(ctx.t, report)),
      );
    }),
};

export const guardianScanCommand: CommandSpec = {
  path: ["guardian", "scan"],
  summaryKey: "command.guardian_scan.summary",
  usage: "finitemonkey guardian scan [--base <ref>] [--record]",
  status: "ready",
  options: { base: { type: "string" }, record: { type: "boolean" } },
  run: (ctx, args) =>
    inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      const scanned = scanChange(ctx.runtime, ctx.t, paths, stringOption(args.values, "base") ?? "HEAD");
      const record = args.values["record"] === true;
      const recorded = record ? recordScan(ctx.runtime, paths, scanned.reports) : 0;
      if (record) noteContextAsked(ctx.runtime, paths, scanned.proportion.askContext);
      return success(
        { schema: GUARDIAN_SCAN_SCHEMA, ...scanned, recorded },
        record ? [] : scanned.reports.map((item) => renderReport(ctx.t, item.report)),
      );
    }),
};
