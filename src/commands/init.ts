import type { CommandArgs } from "../core/args.js";
import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { projectDefaults } from "../defaults/items.js";
import { type CommitsAnswer, commitsAnswer, parseCommitStyle, withCommits } from "../defaults/question.js";
import { githubLines, type GithubStep, githubStep } from "../github/step.js";
import { type LookBack, lookBack } from "../history/look-back.js";
import { PATTERNS } from "../history/patterns.js";
import { applyPlan } from "../install/apply.js";
import { buildPlan, detect, needsWrite, type Plan, readPreviousLock } from "../install/plan.js";
import { type InstallQuestion, type PlanData, planData, planLines } from "../install/report.js";
import { applyProblem, confirmProblem, openProject, planInputFor, planProblem } from "../install/session.js";
import { isPerson } from "../secrets/project.js";
import { trustImplicit } from "../task/trust.js";
import type { CommandSpec } from "./types.js";

export type InstallMode = PlanData["mode"];

export interface LookBackData extends PlanData {
  readonly lookBack: LookBack;
}

export interface InstallRequest {
  readonly mode: InstallMode;
  readonly commits: CommitsAnswer;
  readonly bin: string | undefined;
  readonly marketplace: boolean;
  readonly sandbox?: boolean;
  readonly showDiff: boolean;
}

const flagsFor = (request: InstallRequest): string =>
  [
    `finitemonkey ${request.mode} --yes`,
    ...(request.commits.kind === "given" ? [`--commits ${request.commits.style}`] : []),
    ...(request.bin === undefined ? [] : [`--bin "${request.bin}"`]),
    ...(request.marketplace ? ["--marketplace"] : []),
    ...(request.sandbox === true ? ["--sandbox"] : []),
  ].join(" ");

export const presentPlan = (ctx: Ctx, request: InstallRequest, plan: Plan): CommandResult<PlanData> => {
  const data = planData(ctx.t, plan, request.mode, false, undefined);
  const human = planLines(ctx.t, data, request.showDiff || ctx.dryRun);
  if (ctx.dryRun) return success(data, [...human, ctx.t("install.dry_run")]);
  if (!needsWrite(plan)) return success(data, [...human, ctx.t("install.nothing_to_do")]);
  const next = flagsFor(request);
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
  const hint = request.mode === "init" ? [ctx.t("install.perfil_hint")] : [];
  return success(data, [...planLines(ctx.t, data, request.showDiff), done, ...hint]);
};

const withQuestions = (ctx: Ctx, result: CommandResult<PlanData>, answer: CommitsAnswer): CommandResult<PlanData> => {
  if (answer.kind !== "pending") return result;
  const question: InstallQuestion = {
    id: "commits",
    detected: answer.detected.style,
    conventional: answer.detected.conventional,
    total: answer.detected.total,
    options: ["--commits free", "--commits conventional"],
  };
  const human = [...(result.human ?? []), ctx.t("defaults.question.commits_pending", { ...answer.detected })];
  if (result.ok) return { ...result, data: { ...result.data, questions: [question] }, human };
  return result.data === undefined
    ? { ...result, human }
    : { ...result, data: { ...result.data, questions: [question] }, human };
};

export const runInstall = (ctx: Ctx, request: InstallRequest): CommandResult<PlanData> => {
  const { project, gitRoot } = openProject(ctx);
  const previous = readPreviousLock(project);
  if (!previous.ok) return failureFrom(ctx.t, planProblem(previous.error));
  const defaults = withCommits(projectDefaults(ctx.runtime, project.root), request.commits);
  const input = planInputFor(ctx, defaults, request.bin, request.marketplace, request.sandbox === true);
  const plan = buildPlan(project, detect(project, gitRoot, input), input, previous.value);
  if (!plan.ok) return failureFrom(ctx.t, planProblem(plan.error));
  const result =
    ctx.dryRun || !ctx.yes || !needsWrite(plan.value)
      ? presentPlan(ctx, request, plan.value)
      : applyAndReport(ctx, request, plan.value);
  return withQuestions(ctx, result, request.commits);
};

const initRequest = (args: CommandArgs, commits: CommitsAnswer): InstallRequest => ({
  mode: "init",
  commits,
  bin: stringOption(args.values, "bin"),
  marketplace: args.values["marketplace"] === true,
  sandbox: args.values["sandbox"] === true,
  showDiff: false,
});

const withLookBack = (ctx: Ctx, result: CommandResult<PlanData>): CommandResult<PlanData | LookBackData> => {
  if (!result.ok) return result;
  const root = openProject(ctx).project.root;
  const found = lookBack(ctx.runtime, root, ctx.env);
  const lines = [
    ctx.t("history.title", { sessions: found.sessions, turns: found.turns }),
    ...PATTERNS.map((pattern) => `  ${ctx.t(`history.pattern.${pattern}`, { count: found.counts[pattern] })}`),
    ctx.t("history.estimate"),
  ];
  return { ...result, data: { ...result.data, lookBack: found }, human: [...(result.human ?? []), ...lines] };
};

export type GithubInitData = (PlanData | LookBackData) & { readonly github: GithubStep };

const withGithub = (
  ctx: Ctx,
  result: CommandResult<PlanData | LookBackData>,
): CommandResult<PlanData | LookBackData | GithubInitData> => {
  const root = openProject(ctx).project.root;
  const step = githubStep(ctx.runtime, root, ctx.yes && isPerson(ctx));
  const human = [...(result.human ?? []), ...githubLines(ctx.t, step)];
  return result.ok ? { ...result, data: { ...result.data, github: step }, human } : { ...result, human };
};

export const initCommand: CommandSpec = {
  path: ["init"],
  summaryKey: "command.init.summary",
  usage:
    "finitemonkey init [--commits conventional|free] [--bin <path>] [--marketplace] [--sandbox] [--look-back] [--github] [--dry-run] [--yes]",
  status: "ready",
  options: {
    commits: { type: "string" },
    bin: { type: "string" },
    marketplace: { type: "boolean" },
    sandbox: { type: "boolean" },
    "look-back": { type: "boolean" },
    github: { type: "boolean" },
  },
  run: async (ctx, args) => {
    const raw = stringOption(args.values, "commits");
    const flag = parseCommitStyle(raw);
    if (raw !== undefined && flag === undefined)
      return failureFrom(
        ctx.t,
        usageProblem("invalid_arguments", "defaults.error.commits", "finitemonkey init --commits conventional", {
          value: raw,
        }),
      );
    const result = runInstall(ctx, initRequest(args, await commitsAnswer(ctx, flag)));
    const looked = args.values["look-back"] === true ? withLookBack(ctx, result) : result;
    return args.values["github"] === true ? withGithub(ctx, looked) : looked;
  },
};
