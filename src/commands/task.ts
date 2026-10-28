import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, type Problem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { gitAt, gitRoot, headSha } from "../gate/git.js";
import { DEFAULT_GATE_BUDGET_MS } from "../gate/hooks/common.js";
import { currentReport } from "../gate/hooks/snapshot.js";
import { reportLines } from "../gate/render.js";
import { runGate } from "../gate/run.js";
import { initPlan } from "../plan/master.js";
import { spendLine } from "../spend/hook.js";
import { blocksNewTask, budgetStatus } from "../spend/status.js";
import { type CreateProblem, createTask, type TaskDraft } from "../task/create.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { contractJson } from "../task/serialize.js";
import { closeTask, readState, writeState } from "../task/state.js";
import { GIT_REQUIREMENTS, type GitRequirement, SIZES, TASK_SCHEMA } from "../task/types.js";
import { runResult } from "./gate.js";
import type { CommandSpec, OptionValues } from "./types.js";

const problem = (
  code: Problem["code"],
  messageKey: Problem["messageKey"],
  fix: string,
  params: Problem["params"] = {},
  exitCode: Problem["exitCode"] = ExitCode.Usage,
): Problem => ({
  code,
  messageKey,
  params,
  fix,
  exitCode,
});

const projectOf = (ctx: Ctx): FmPaths | undefined => {
  const root = gitRoot(gitAt(ctx.runtime, ctx.cwd));
  return root === undefined ? undefined : fmPaths(root);
};

const noRepo = (ctx: Ctx): CommandResult =>
  failureFrom(ctx.t, problem("not_a_git_repo", "error.not_a_git_repo", "git init", {}, ExitCode.NotConfigured));

const list = (values: OptionValues, name: string): readonly string[] => {
  const value = values[name];
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return raw.filter((item): item is string => typeof item === "string" && item.trim() !== "");
};

const csv = (values: OptionValues, name: string): readonly string[] =>
  list(values, name)
    .flatMap((item) => item.split(",").map((part) => part.trim()))
    .filter((part) => part !== "");

const positive = (values: OptionValues, name: string): number | undefined => {
  const parsed = Number.parseInt(stringOption(values, name) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const draftFrom = (ctx: Ctx, paths: FmPaths, id: string, values: OptionValues): TaskDraft => {
  const files = positive(values, "budget-files");
  const lines = positive(values, "budget-lines");
  const size = SIZES.find((item) => item === stringOption(values, "size")) ?? "S";
  return {
    id,
    goal: stringOption(values, "goal") ?? id,
    size,
    base: headSha(gitAt(ctx.runtime, paths.root)),
    paths: csv(values, "paths"),
    runs: list(values, "run"),
    tests: stringOption(values, "tests"),
    git: csv(values, "git").filter((item): item is GitRequirement => GIT_REQUIREMENTS.some((known) => known === item)),
    manual: list(values, "manual"),
    budget:
      files === undefined && lines === undefined
        ? undefined
        : { ...(files === undefined ? {} : { files }), ...(lines === undefined ? {} : { lines }) },
  };
};

const createFailure = (ctx: Ctx, failure: CreateProblem): CommandResult => {
  if (failure.kind === "exists") {
    return failureFrom(
      ctx.t,
      problem("task_exists", "error.task_exists", `finitemonkey task show ${failure.id}`, { task: failure.id }),
    );
  }
  const detail = failure.kind === "invalid" ? failure.issues.join("; ") : failure.detail;
  return failureFrom(ctx.t, problem("task_invalid", "error.task_invalid", "finitemonkey help task new", { detail }));
};

const newTask = (ctx: Ctx, id: string | undefined, values: OptionValues): CommandResult => {
  if (id === undefined)
    return failureFrom(
      ctx.t,
      problem("invalid_arguments", "error.invalid_arguments", "finitemonkey help task new", { detail: "missing <id>" }),
    );
  const paths = projectOf(ctx);
  if (paths === undefined) return noRepo(ctx);
  const budget = budgetStatus({ runtime: ctx.runtime, paths, env: ctx.env, sessionId: undefined, refresh: true });
  if (blocksNewTask(budget))
    return failureFrom(
      ctx.t,
      needsPersonProblem("budget.blocked", "fm: allow budget <reason>", { spend: spendLine(ctx.t, budget.spends) }),
    );
  const created = createTask(ctx.runtime, paths, draftFrom(ctx, paths, id, values));
  if (!created.ok) return createFailure(ctx, created.error);
  const plan = created.value.contract.size === "L" ? initPlan(ctx.runtime, ctx.t, paths.root) : undefined;
  const planLine = plan?.ok === true && plan.value.created ? [ctx.t("plan.created", { file: plan.value.file })] : [];
  const data = {
    schema: TASK_SCHEMA,
    file: paths.task(id),
    active: true,
    contract: contractJson(created.value.contract),
  };
  return {
    ...success(data, [
      ctx.t("task.created", { task: id, file: paths.task(id) }),
      created.value.text.trimEnd(),
      ...planLine,
    ]),
    next: "finitemonkey gate",
  };
};

const showTask = (ctx: Ctx, id: string | undefined): CommandResult => {
  const paths = projectOf(ctx);
  if (paths === undefined) return noRepo(ctx);
  const active = readState(ctx.runtime, paths).active;
  const target = id ?? active;
  const report = currentReport(ctx.runtime, paths, undefined, target);
  if (report === undefined) {
    return failureFrom(
      ctx.t,
      problem(
        "task_not_found",
        "error.task_not_found",
        "finitemonkey task new <id> --goal <text>",
        { task: target ?? "-" },
        ExitCode.NotConfigured,
      ),
    );
  }
  return success({ schema: TASK_SCHEMA, active: active ?? null, report }, reportLines(ctx.t, report));
};

const doneTask = (ctx: Ctx, id: string | undefined): CommandResult => {
  const paths = projectOf(ctx);
  if (paths === undefined) return noRepo(ctx);
  const target = id ?? readState(ctx.runtime, paths).active;
  const run = runGate({
    runtime: ctx.runtime,
    cwd: ctx.cwd,
    env: ctx.env,
    sessionId: undefined,
    budgetMs: DEFAULT_GATE_BUDGET_MS,
    fast: false,
    noSkip: true,
    ...(target === undefined ? {} : { taskId: target }),
  });
  const result = runResult(ctx, run, true);
  if (!result.ok || run.kind !== "done" || run.report.implicit) return result;
  writeState(ctx.runtime, paths, closeTask(readState(ctx.runtime, paths), run.report.task));
  return { ...result, human: [...(result.human ?? []), ctx.t("task.done", { task: run.report.task })] };
};

const TASK_OPTIONS = {
  goal: { type: "string" },
  size: { type: "string" },
  paths: { type: "string", multiple: true },
  run: { type: "string", multiple: true },
  tests: { type: "string" },
  git: { type: "string" },
  manual: { type: "string", multiple: true },
  "budget-files": { type: "string" },
  "budget-lines": { type: "string" },
} as const;

export const taskNewCommand: CommandSpec = {
  path: ["task", "new"],
  summaryKey: "command.task_new.summary",
  usage:
    "finitemonkey task new <id> --goal <text> [--size S|M|L] [--paths <globs>] [--run <cmd>]... [--tests <cmd>] [--git committed,pushed,pr_open] [--manual <text>]...",
  status: "ready",
  options: TASK_OPTIONS,
  maxPositionals: 1,
  run: (ctx, args) => Promise.resolve(newTask(ctx, args.positionals[0], args.values)),
};

export const taskShowCommand: CommandSpec = {
  path: ["task", "show"],
  summaryKey: "command.task_show.summary",
  usage: "finitemonkey task show [<id>]",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => Promise.resolve(showTask(ctx, args.positionals[0])),
};

export const taskDoneCommand: CommandSpec = {
  path: ["task", "done"],
  summaryKey: "command.task_done.summary",
  usage: "finitemonkey task done [<id>]",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => Promise.resolve(doneTask(ctx, args.positionals[0])),
};
