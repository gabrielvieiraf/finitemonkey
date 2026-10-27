import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { DEFAULT_GATE_BUDGET_MS } from "../gate/hooks/common.js";
import { runGate } from "../gate/run.js";
import { amendTask } from "../task/amend.js";
import { fmPaths } from "../task/paths.js";
import { reopenTask } from "../task/reopen.js";
import { readState } from "../task/state.js";
import { TASK_SCHEMA } from "../task/types.js";
import { runResult } from "./gate.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

const REOPEN_USAGE = "finitemonkey task reopen <id> <criterion>...";
const AMEND_USAGE =
  "finitemonkey task amend <criterion> --reason <text> --evidence <text> [--run <cmd>] [--description <text>] [--task <id>]";

const recheck = (ctx: Ctx, id: string): CommandResult =>
  runResult(
    ctx,
    runGate({
      runtime: ctx.runtime,
      cwd: ctx.cwd,
      env: ctx.env,
      sessionId: undefined,
      budgetMs: DEFAULT_GATE_BUDGET_MS,
      fast: false,
      noSkip: true,
      taskId: id,
    }),
    true,
  );

export const taskReopenCommand: CommandSpec = {
  path: ["task", "reopen"],
  summaryKey: "command.task_reopen.summary",
  usage: REOPEN_USAGE,
  status: "ready",
  maxPositionals: 32,
  run: (ctx, args): Promise<CommandResult> => {
    const repo = repoOf(ctx);
    if (repo === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const [id, ...criteria] = args.positionals;
    if (id === undefined || criteria.length === 0)
      return Promise.resolve(failureFrom(ctx.t, usageProblem("invalid_arguments", "task.reopen.usage", REOPEN_USAGE)));
    const reopened = reopenTask(ctx.runtime, fmPaths(repo.root), id, criteria);
    if (!reopened.ok) {
      const detail =
        reopened.error.kind === "unknown_criteria" ? reopened.error.criteria.join(", ") : reopened.error.kind;
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "task.reopen.failed", REOPEN_USAGE, { detail })),
      );
    }
    const result = recheck(ctx, id);
    return Promise.resolve({
      ...result,
      human: [ctx.t("task.reopen.done", { task: id, criteria: criteria.join(", ") }), ...(result.human ?? [])],
    });
  },
};

export const taskAmendCommand: CommandSpec = {
  path: ["task", "amend"],
  summaryKey: "command.task_amend.summary",
  usage: AMEND_USAGE,
  status: "ready",
  maxPositionals: 1,
  options: {
    reason: { type: "string" },
    evidence: { type: "string" },
    run: { type: "string" },
    description: { type: "string" },
    task: { type: "string" },
  },
  run: (ctx, args): Promise<CommandResult> => {
    const repo = repoOf(ctx);
    if (repo === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const paths = fmPaths(repo.root);
    const criterion = args.positionals[0];
    const reason = stringOption(args.values, "reason")?.trim() ?? "";
    const evidence = stringOption(args.values, "evidence")?.trim() ?? "";
    const task = stringOption(args.values, "task") ?? readState(ctx.runtime, paths).active;
    if (criterion === undefined || task === undefined || reason.length < 3 || evidence.length < 3)
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "task.amend.needs_reason", AMEND_USAGE)),
      );
    const run = stringOption(args.values, "run");
    const description = stringOption(args.values, "description");
    const amended = amendTask(ctx.runtime, paths, {
      task,
      criterion,
      reason,
      evidence,
      ...(run === undefined ? {} : { run }),
      ...(description === undefined ? {} : { description }),
    });
    if (!amended.ok)
      return Promise.resolve(
        failureFrom(
          ctx.t,
          usageProblem("invalid_arguments", `task.amend.${amended.error}`, AMEND_USAGE, { criterion, task }),
        ),
      );
    return Promise.resolve({
      ...success({ schema: TASK_SCHEMA, amendment: amended.value }, [ctx.t("task.amend.done", { criterion, task })]),
      next: `fm: trust ${task}`,
    });
  },
};
