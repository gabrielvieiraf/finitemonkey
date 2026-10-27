import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { runMerge } from "../merge/protocol.js";
import { type MergeReport } from "../merge/report.js";
import type { CommandSpec, OptionValues } from "./types.js";
import { commandOwner } from "./wt.js";

const list = (values: OptionValues, name: string): readonly string[] => {
  const value = values[name];
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
};

const humanOf = (ctx: Ctx, report: MergeReport): readonly string[] => [
  ctx.t(report.outcome === "merged" ? "merge.done" : "merge.stopped", {
    source: report.source.ref,
    target: report.target.ref,
    branch: report.integration.branch,
    count: report.stops.length,
  }),
  ...report.files.flatMap((file) =>
    (file.hunks.length === 0 ? [file] : file.hunks).map((hunk) =>
      ctx.t("merge.file", { path: file.path, cls: hunk.class, rule: hunk.rule, decision: hunk.decision }),
    ),
  ),
  ...report.stops.map((stop) => ctx.t("merge.stop", { reason: stop.reason, path: stop.path ?? "-" })),
  ...report.semanticCandidates.map((item) =>
    ctx.t("merge.semantic", { symbol: item.symbol, file: item.file, reason: item.reason }),
  ),
  ctx.t("merge.report", { path: report.reportPath }),
];

export const mergeCommand: CommandSpec = {
  path: ["merge"],
  summaryKey: "merge.command",
  usage:
    "finitemonkey merge <source> [--into <target>] [--check <command>]... [--target-contract <file>] [--source-contract <file>] [--declare-removal <path>]... [--json]",
  status: "ready",
  options: {
    into: { type: "string" },
    check: { type: "string", multiple: true },
    "target-contract": { type: "string" },
    "source-contract": { type: "string" },
    "declare-removal": { type: "string", multiple: true },
  },
  maxPositionals: 1,
  run: (ctx, args): Promise<CommandResult> => {
    const source = args.positionals[0];
    if (source === undefined || source === "") {
      return Promise.resolve(
        failureFrom(
          ctx.t,
          usageProblem("invalid_arguments", "merge.error.needs_source", "finitemonkey merge <branch>"),
        ),
      );
    }
    const report = runMerge(ctx.runtime, ctx.cwd, ctx.env, {
      source,
      target: stringOption(args.values, "into"),
      checks: list(args.values, "check"),
      targetContract: stringOption(args.values, "target-contract"),
      sourceContract: stringOption(args.values, "source-contract"),
      declaredRemovals: list(args.values, "declare-removal"),
      owner: commandOwner(ctx),
    });
    if (!report.ok) {
      return Promise.resolve(
        failureFrom(ctx.t, {
          ...usageProblem("merge_failed", "merge.error.failed", "finitemonkey wt doctor", { detail: report.error }),
          exitCode: ExitCode.CheckFailed,
        }),
      );
    }
    const human = humanOf(ctx, report.value);
    if (report.value.outcome === "merged") return Promise.resolve(success(report.value, human));
    return Promise.resolve({
      ok: false,
      exitCode: ExitCode.CheckFailed,
      error: {
        code: "merge_stopped",
        message: ctx.t("merge.stopped", {
          source: report.value.source.ref,
          target: report.value.target.ref,
          branch: report.value.integration.branch,
          count: report.value.stops.length,
        }),
        fix: `finitemonkey wt archive ${report.value.integration.id}`,
      },
      data: report.value,
      human,
    });
  },
};
