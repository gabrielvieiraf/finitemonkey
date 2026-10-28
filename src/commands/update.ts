import { type CommandArgs, stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { projectDefaults } from "../defaults/items.js";
import { ExitCode } from "../exit-codes.js";
import { buildPlan, detect, hasChanges, readPreviousLock } from "../install/plan.js";
import { type PlanData, planData, planLines } from "../install/report.js";
import { notInstalled, openProject, planInputFor, planProblem } from "../install/session.js";
import { runInstall } from "./init.js";
import type { CommandSpec } from "./types.js";

const check = (ctx: Ctx, bin: string | undefined): CommandResult<PlanData> => {
  const { project, gitRoot } = openProject(ctx);
  const previous = readPreviousLock(project);
  if (!previous.ok) return failureFrom(ctx.t, planProblem(previous.error));
  if (previous.value === undefined) return failureFrom(ctx.t, notInstalled());
  const input = planInputFor(ctx, projectDefaults(ctx.runtime, project.root), bin, false);
  const plan = buildPlan(project, detect(project, gitRoot, input), input, previous.value);
  if (!plan.ok) return failureFrom(ctx.t, planProblem(plan.error));
  const data = planData(ctx.t, plan.value, "update", false, undefined);
  const human = planLines(ctx.t, data, true);
  if (!hasChanges(plan.value)) return success(data, [...human, ctx.t("install.up_to_date")]);
  return {
    ok: false,
    exitCode: ExitCode.CheckFailed,
    data,
    human,
    error: { code: "install_outdated", message: ctx.t("error.install_outdated"), fix: "finitemonkey update --yes" },
  };
};

const runUpdate = (ctx: Ctx, args: CommandArgs): CommandResult<PlanData> => {
  const bin = stringOption(args.values, "bin");
  if (args.values["check"] === true) return check(ctx, bin);
  const { project } = openProject(ctx);
  const previous = readPreviousLock(project);
  if (!previous.ok) return failureFrom(ctx.t, planProblem(previous.error));
  if (previous.value === undefined) return failureFrom(ctx.t, notInstalled());
  const request = {
    mode: "update" as const,
    commits: { kind: "none" as const },
    bin,
    marketplace: false,
    showDiff: true,
  };
  return runInstall(ctx, request);
};

export const updateCommand: CommandSpec = {
  path: ["update"],
  summaryKey: "command.update.summary",
  usage: "finitemonkey update [--check] [--bin <path>] [--yes]",
  status: "ready",
  options: { check: { type: "boolean" }, bin: { type: "string" } },
  run: (ctx, args) => Promise.resolve(runUpdate(ctx, args)),
};
