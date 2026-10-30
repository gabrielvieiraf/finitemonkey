import { readCost } from "../bridge/cost.js";
import { stringOption } from "../core/args.js";
import { toAbsolutePath } from "../core/brand.js";
import { usageProblem } from "../core/problem.js";
import { failureFrom, success } from "../core/result.js";
import { readLedger } from "../evidence/ledger.js";
import { knownTasks } from "../guardian/tasks.js";
import { featureMode } from "../policy/feature.js";
import { fmPaths } from "../task/paths.js";
import { readCommits } from "../team/history.js";
import { renderReport } from "../team/render.js";
import { DEFAULT_K, teamReport } from "../team/report.js";
import { guardianWriteProblem, inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

export const TEAM_FEATURE = "team-dashboard";
const USAGE = "finitemonkey team report [--k <n>] [--out <file>] [--json]";

export const teamReportCommand: CommandSpec = {
  path: ["team", "report"],
  summaryKey: "command.team_report.summary",
  usage: USAGE,
  status: "ready",
  options: { k: { type: "string" }, out: { type: "string" } },
  run: (ctx, args) =>
    inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      if (featureMode(ctx.runtime, paths, TEAM_FEATURE) === "off")
        return failureFrom(
          ctx.t,
          usageProblem(
            "invalid_arguments",
            "team.report.off",
            "set guards.team-dashboard: shadow in .finitemonkey/policy.yml",
          ),
        );
      const k = Number(stringOption(args.values, "k") ?? DEFAULT_K);
      if (!Number.isInteger(k) || k < 1)
        return failureFrom(ctx.t, usageProblem("invalid_arguments", "team.report.k", USAGE));
      const ledgers = knownTasks(ctx.runtime, paths).map((task) => ({
        task: task.contract.id,
        entries: readLedger(ctx.runtime, paths.evidence(task.contract.id)),
      }));
      const spend = readCost(ctx.runtime, paths).map((line) => ({ task: line.task, at: line.at, usd: line.usd }));
      const report = teamReport(readCommits(ctx.runtime, root), ledgers, spend, k);
      const lines = renderReport(report);
      const out = stringOption(args.values, "out");
      if (out !== undefined && !ctx.runtime.writeText(toAbsolutePath(out, root), `${lines.join("\n")}\n`).ok)
        return failureFrom(ctx.t, guardianWriteProblem(out));
      return success(report, lines);
    }),
};
