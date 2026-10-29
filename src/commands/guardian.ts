import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, type Problem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { GOAL_KINDS, type GoalKind, GOALS_SCHEMA, nextGoalId, readGoals, writeGoals } from "../guardian/goals.js";
import { guardianStatus } from "../guardian/status.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

type Root = NonNullable<ReturnType<typeof repoOf>>["root"];

export const inGuardianRepo = (ctx: Ctx, run: (root: Root) => CommandResult): Promise<CommandResult> => {
  const repo = repoOf(ctx);
  return Promise.resolve(repo === undefined ? failureFrom(ctx.t, notRepository(ctx.cwd)) : run(repo.root));
};

export const guardianWriteProblem = (file: string): Problem => ({
  code: "guardian_write_failed",
  messageKey: "guardian.error.write",
  params: { file },
  fix: "check that .finitemonkey can be written",
  exitCode: ExitCode.CheckFailed,
});

export const guardianStatusCommand: CommandSpec = {
  path: ["guardian", "status"],
  summaryKey: "command.guardian_status.summary",
  usage: "finitemonkey guardian status",
  status: "ready",
  run: (ctx) =>
    inGuardianRepo(ctx, (root) => {
      const status = guardianStatus(ctx.runtime, fmPaths(root));
      const head = ctx.t("guardian.status.head", {
        stated: status.goals.stated,
        inferred: status.goals.inferred,
        tasks: status.tasks,
      });
      const lines = status.signals.map((item) =>
        ctx.t(`guardian.signal.${item.kind}`, { subject: item.subject, detail: item.detail }),
      );
      return success(status, [head, ...(lines.length === 0 ? [ctx.t("guardian.status.clean")] : lines)]);
    }),
};

const kindOf = (value: string | undefined): GoalKind | undefined =>
  GOAL_KINDS.find((kind) => kind === (value ?? "goals").replace(/-/g, "_"));

const ADD_USAGE = "finitemonkey guardian goal add <text> [--kind goals|constraints|non-goals|done|rejected]";

export const guardianGoalAddCommand: CommandSpec = {
  path: ["guardian", "goal", "add"],
  summaryKey: "command.guardian_goal_add.summary",
  usage: ADD_USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { kind: { type: "string" } },
  run: (ctx, args) => {
    const text = args.positionals[0]?.trim() ?? "";
    const kind = kindOf(stringOption(args.values, "kind"));
    if (text === "" || kind === undefined)
      return Promise.resolve(failureFrom(ctx.t, usageProblem("invalid_arguments", "guardian.error.add", ADD_USAGE)));
    return inGuardianRepo(ctx, (root) => {
      const goals = readGoals(ctx.runtime, root);
      const origin = isPerson(ctx) ? "stated" : "inferred";
      const entry = { id: nextGoalId(goals, kind), kind, text, origin } as const;
      if (!writeGoals(ctx.runtime, root, { ...goals, entries: [...goals.entries, entry] }))
        return failureFrom(ctx.t, guardianWriteProblem(".finitemonkey/goals.yml"));
      return success({ schema: GOALS_SCHEMA, entry }, [ctx.t(`guardian.goal.added_${origin}`, { id: entry.id })]);
    });
  },
};

const CONFIRM_USAGE = "finitemonkey guardian goal confirm <id>";

export const guardianGoalConfirmCommand: CommandSpec = {
  path: ["guardian", "goal", "confirm"],
  summaryKey: "command.guardian_goal_confirm.summary",
  usage: CONFIRM_USAGE,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => {
    const id = args.positionals[0]?.trim() ?? "";
    if (id === "")
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "guardian.error.confirm", CONFIRM_USAGE)),
      );
    if (!isPerson(ctx))
      return Promise.resolve(failureFrom(ctx.t, needsPersonProblem("guardian.error.person_only", CONFIRM_USAGE)));
    return inGuardianRepo(ctx, (root) => {
      const goals = readGoals(ctx.runtime, root);
      if (!goals.entries.some((entry) => entry.id === id))
        return failureFrom(
          ctx.t,
          usageProblem("invalid_arguments", "guardian.error.unknown_goal", CONFIRM_USAGE, { id }),
        );
      const entries = goals.entries.map((entry) => (entry.id === id ? { ...entry, origin: "stated" as const } : entry));
      if (!writeGoals(ctx.runtime, root, { ...goals, entries }))
        return failureFrom(ctx.t, guardianWriteProblem(".finitemonkey/goals.yml"));
      return success({ schema: GOALS_SCHEMA, id, origin: "stated" }, [ctx.t("guardian.goal.confirmed", { id })]);
    });
  },
};
