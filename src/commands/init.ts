import type { CommandArgs } from "../core/args.js";
import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { applyPlan } from "../install/apply.js";
import { parsePreset, type Preset } from "../install/layout.js";
import { buildPlan, detect, needsWrite, type Plan, readPreviousLock } from "../install/plan.js";
import { type PlanData, planData, planLines } from "../install/report.js";
import {
  applyProblem,
  confirmProblem,
  invalidPreset,
  openProject,
  planInputFor,
  planProblem,
} from "../install/session.js";
import { trustImplicit } from "../task/trust.js";
import type { CommandSpec } from "./types.js";

export type InstallMode = PlanData["mode"];

export interface InstallRequest {
  readonly mode: InstallMode;
  readonly preset: string | undefined;
  readonly bin: string | undefined;
  readonly marketplace: boolean;
  readonly showDiff: boolean;
}

const flagsFor = (request: InstallRequest, preset: Preset): string =>
  [
    `finitemonkey ${request.mode} --yes`,
    ...(request.mode === "init" && preset !== "neutral" ? [`--preset ${preset}`] : []),
    ...(request.bin === undefined ? [] : [`--bin "${request.bin}"`]),
    ...(request.marketplace ? ["--marketplace"] : []),
  ].join(" ");

export const presentPlan = (ctx: Ctx, request: InstallRequest, plan: Plan): CommandResult<PlanData> => {
  const data = planData(ctx.t, plan, request.mode, false, undefined);
  const human = planLines(ctx.t, data, request.showDiff || ctx.dryRun);
  if (ctx.dryRun) return success(data, [...human, ctx.t("install.dry_run")]);
  if (!needsWrite(plan)) return success(data, [...human, ctx.t("install.nothing_to_do")]);
  const next = flagsFor(request, plan.preset);
  const problem = confirmProblem(request.mode, ctx.t("install.confirm_question"), next);
  return { ...failureFrom(ctx.t, { ...problem, data }, human), next };
};

const applyAndReport = (ctx: Ctx, request: InstallRequest, plan: Plan): CommandResult<PlanData> => {
  const project = openProject(ctx).project;
  const applied = applyPlan(project, plan, ctx.version);
  if (!applied.ok) return failureFrom(ctx.t, applyProblem(applied.error));
  trustImplicit(ctx.runtime, project.root, project);
  const data = planData(ctx.t, plan, request.mode, true, applied.value.backup);
  const done = ctx.t(request.mode === "init" ? "install.done_init" : "install.done_update");
  return success(data, [...planLines(ctx.t, data, request.showDiff), done]);
};

export const runInstall = (ctx: Ctx, request: InstallRequest, presetFallback: Preset): CommandResult<PlanData> => {
  const preset = request.preset === undefined ? presetFallback : parsePreset(request.preset);
  if (preset === undefined) return failureFrom(ctx.t, invalidPreset(request.preset ?? ""));
  const { project, gitRoot } = openProject(ctx);
  const previous = readPreviousLock(project);
  if (!previous.ok) return failureFrom(ctx.t, planProblem(previous.error));
  const input = planInputFor(ctx, preset, request.bin, request.marketplace);
  const plan = buildPlan(project, detect(project, gitRoot, input), input, previous.value);
  if (!plan.ok) return failureFrom(ctx.t, planProblem(plan.error));
  if (ctx.dryRun || !ctx.yes || !needsWrite(plan.value)) return presentPlan(ctx, request, plan.value);
  return applyAndReport(ctx, request, plan.value);
};

const initRequest = (args: CommandArgs): InstallRequest => ({
  mode: "init",
  preset: stringOption(args.values, "preset"),
  bin: stringOption(args.values, "bin"),
  marketplace: args.values["marketplace"] === true,
  showDiff: false,
});

export const initCommand: CommandSpec = {
  path: ["init"],
  summaryKey: "command.init.summary",
  usage: "finitemonkey init [--preset neutral|gabriel] [--bin <path>] [--marketplace] [--dry-run] [--yes]",
  status: "ready",
  options: {
    preset: { type: "string" },
    bin: { type: "string" },
    marketplace: { type: "boolean" },
  },
  run: (ctx, args) => Promise.resolve(runInstall(ctx, initRequest(args), "neutral")),
};
