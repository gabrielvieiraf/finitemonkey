import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import type { Problem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { runBaseline } from "../gate/baseline-run.js";
import { gitAt, gitRoot } from "../gate/git.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { DEFAULT_GATE_BUDGET_MS } from "../gate/hooks/common.js";
import { openPrsLine, refreshPrs } from "../gate/hooks/prs.js";
import { readGateStatus } from "../gate/hooks/status.js";
import { ISOLATED_FEATURE } from "../gate/isolated.js";
import { reportLines } from "../gate/render.js";
import type { GateReport } from "../gate/report.js";
import { type GateRun, runGate } from "../gate/run.js";
import { unreviewedBypasses } from "../guards/bypass/ledger.js";
import { featureMode } from "../policy/feature.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

const budgetMs = (raw: string | undefined): number => {
  const seconds = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_GATE_BUDGET_MS;
};

const notRun = (detail: string): Problem => ({
  code: "gate_not_run",
  messageKey: "error.gate_not_run",
  params: { detail },
  fix: "finitemonkey doctor",
  exitCode: ExitCode.NotConfigured,
});

export const lastRunRefusal = (ctx: Ctx): Problem | undefined => {
  const root = findRepoRoot(ctx.runtime, ctx.cwd) ?? gitRoot(gitAt(ctx.runtime, ctx.cwd));
  const bypassed = root === undefined ? [] : unreviewedBypasses(ctx.runtime, fmPaths(root));
  if (bypassed.length > 0)
    return {
      code: "guard_bypassed",
      messageKey: "bypass.refused",
      params: { count: bypassed.length },
      fix: "finitemonkey bypass review",
      exitCode: ExitCode.CheckFailed,
    };
  const status = root === undefined ? undefined : readGateStatus(ctx.runtime, fmPaths(root));
  if (status?.status === "released_by_cap") {
    return {
      code: "gate_released_by_cap",
      messageKey: "pr.error.released_by_cap",
      params: { at: status.at, task: status.task },
      fix: "finitemonkey gate",
      exitCode: ExitCode.CheckFailed,
    };
  }
  if (status?.status !== "not_run") return undefined;
  return {
    code: "gate_not_run",
    messageKey: "error.gate_last_not_run",
    params: { detail: status.detail },
    fix: "finitemonkey gate",
    exitCode: ExitCode.CheckFailed,
  };
};

export const gateResult = (ctx: Ctx, report: GateReport, strict: boolean): CommandResult<GateReport> => {
  const human = reportLines(ctx.t, report);
  const failedVerdict = report.verdict === "failed" || (strict && report.verdict === "incomplete");
  if (!failedVerdict) return success(report, human);
  const code = report.verdict === "failed" ? "gate_failed" : "gate_incomplete";
  return {
    ok: false,
    exitCode: ExitCode.CheckFailed,
    data: report,
    human,
    error: { code, message: ctx.t(`error.${code}`, report.counts), fix: `finitemonkey gate --task ${report.task}` },
  };
};

export const runResult = (ctx: Ctx, run: GateRun, strict: boolean): CommandResult => {
  if (run.kind === "done") return gateResult(ctx, run.report, strict);
  if (run.kind === "skipped") return success({ skipped: run.reason }, [ctx.t(`gate.skipped.${run.reason}`)]);
  return failureFrom(ctx.t, notRun(failureDetail(ctx, run.failure)));
};

const failureDetail = (ctx: Ctx, failure: Extract<GateRun, { kind: "failed" }>["failure"]): string => {
  if (failure.kind === "contract") return `${failure.problem.kind}: ${failure.problem.id}`;
  if (failure.kind === "isolated") return ctx.t("gate.fail.isolated", { step: failure.step, detail: failure.detail });
  return failure.kind;
};

type IsolatedChoice = "isolated" | "in_place" | "off";

const isolatedChoice = (ctx: Ctx, asked: boolean): IsolatedChoice => {
  const root = gitRoot(gitAt(ctx.runtime, ctx.cwd));
  const mode = root === undefined ? "shadow" : featureMode(ctx.runtime, fmPaths(root), ISOLATED_FEATURE);
  if (mode === "off") return asked ? "off" : "in_place";
  return asked || mode === "active" ? "isolated" : "in_place";
};

const prsResult = (ctx: Ctx): CommandResult => {
  const root = gitRoot(gitAt(ctx.runtime, ctx.cwd));
  const list = root === undefined ? undefined : refreshPrs(ctx.runtime, fmPaths(root));
  return success(
    { prs: list ?? null },
    list === undefined ? [] : openPrsLine(ctx.t, ctx.runtime, fmPaths(root ?? ctx.cwd)),
  );
};

export const gateCommand: CommandSpec = {
  path: ["gate"],
  summaryKey: "command.gate.summary",
  usage: "finitemonkey gate [--task <id>] [--fast] [--strict] [--budget <seconds>] [--baseline] [--prs] [--isolated]",
  status: "ready",
  options: {
    task: { type: "string" },
    fast: { type: "boolean" },
    strict: { type: "boolean" },
    budget: { type: "string" },
    baseline: { type: "boolean" },
    prs: { type: "boolean" },
    isolated: { type: "boolean" },
  },
  run: (ctx, args) => {
    const taskId = stringOption(args.values, "task");
    const options = {
      runtime: ctx.runtime,
      cwd: ctx.cwd,
      env: ctx.env,
      sessionId: undefined,
      budgetMs: budgetMs(stringOption(args.values, "budget")),
      fast: args.values["fast"] === true,
      ...(taskId === undefined ? {} : { taskId }),
    };
    if (args.values["prs"] === true) return Promise.resolve(prsResult(ctx));
    if (args.values["baseline"] === true) {
      const baseline = runBaseline(options);
      return Promise.resolve(
        success(baseline, [
          ctx.t(baseline.kind === "recorded" ? "gate.baseline.recorded" : "gate.baseline.skipped", {
            reason: baseline.kind === "skipped" ? baseline.reason : "",
          }),
        ]),
      );
    }
    const choice = isolatedChoice(ctx, args.values["isolated"] === true);
    if (choice === "off") return Promise.resolve(failureFrom(ctx.t, notRun(ctx.t("gate.isolated.off"))));
    return Promise.resolve(
      runResult(ctx, runGate({ ...options, isolated: choice === "isolated" }), args.values["strict"] === true),
    );
  },
};
