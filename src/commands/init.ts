import type { CommandArgs } from "../core/args.js";
import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { conventionFlags, withConventionQuestions } from "../defaults/convention-plan.js";
import { type ConventionAnswer, conventionAnswers, withConventions } from "../defaults/convention-question.js";
import { projectDefaults } from "../defaults/items.js";
import { type CommitsAnswer, commitsAnswer, parseCommitStyle, withCommits } from "../defaults/question.js";
import { githubLines, type GithubStep, githubStep } from "../github/step.js";
import { type LookBack, lookBack } from "../history/look-back.js";
import { PATTERNS } from "../history/patterns.js";
import { applyPlan } from "../install/apply.js";
import { type Channel, parseChannel } from "../install/marketplace.js";
import { buildPlan, detect, needsWrite, type Plan, readPreviousLock } from "../install/plan.js";
import { type InstallQuestion, type PlanData, planData, planLines } from "../install/report.js";
import { applyProblem, confirmProblem, openProject, planInputFor, planProblem } from "../install/session.js";
import { type EnginePlan, enginePlan } from "../look/engine.js";
import { type AskLine, lineReader } from "../perfil/lines.js";
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
  readonly conventions?: readonly ConventionAnswer[];
  readonly bin: string | undefined;
  readonly marketplace: boolean;
  readonly channel?: Channel;
  readonly sandbox?: boolean;
  readonly showDiff: boolean;
}

const flagsFor = (request: InstallRequest): string =>
  [
    `finitemonkey ${request.mode} --yes`,
    ...(request.commits.kind === "given" ? [`--commits ${request.commits.style}`] : []),
    ...(request.conventions ?? []).flatMap((answer) =>
      answer.kind === "given" ? [`--${answer.id} ${answer.value}`] : [],
    ),
    ...(request.bin === undefined ? [] : [`--bin "${request.bin}"`]),
    ...(request.marketplace ? ["--marketplace"] : []),
    ...(request.channel === undefined ? [] : [`--channel ${request.channel}`]),
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
  const conventions = request.conventions ?? [];
  const defaults = withConventions(
    withCommits(projectDefaults(ctx.runtime, project.root), request.commits),
    conventions,
  );
  const marketplace = request.marketplace && (request.channel ?? true);
  const input = planInputFor(ctx, defaults, request.bin, marketplace, request.sandbox === true);
  const plan = buildPlan(project, detect(project, gitRoot, input), input, previous.value);
  if (!plan.ok) return failureFrom(ctx.t, planProblem(plan.error));
  const result =
    ctx.dryRun || !ctx.yes || !needsWrite(plan.value)
      ? presentPlan(ctx, request, plan.value)
      : applyAndReport(ctx, request, plan.value);
  return withConventionQuestions(ctx, withQuestions(ctx, result, request.commits), conventions);
};

const initRequest = (
  args: CommandArgs,
  commits: CommitsAnswer,
  conventions: readonly ConventionAnswer[],
): InstallRequest => {
  const channel = parseChannel(stringOption(args.values, "channel"));
  return {
    mode: "init",
    commits,
    conventions,
    bin: stringOption(args.values, "bin"),
    marketplace: args.values["marketplace"] === true || channel !== undefined,
    ...(channel === undefined ? {} : { channel }),
    sandbox: args.values["sandbox"] === true,
    showDiff: false,
  };
};

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

export type LookInitData = (PlanData | LookBackData | GithubInitData) & { readonly look: EnginePlan };

export const engineLines = (t: Ctx["t"], plan: EnginePlan, confirmed: boolean): readonly string[] => {
  const params = { package: plan.package, size: plan.sizeMb, command: plan.command };
  if (plan.present) return [t("look.engine.present", params)];
  if (plan.added) return [t("look.engine.added", params)];
  if (confirmed) return [t("look.engine.offer", params), t("look.engine.failed", params)];
  return [t("look.engine.offer", params), t("look.engine.consent", params)];
};

const withLook = (
  ctx: Ctx,
  result: CommandResult<PlanData | LookBackData | GithubInitData>,
): CommandResult<PlanData | LookBackData | GithubInitData | LookInitData> => {
  const root = openProject(ctx).project.root;
  const confirmed = ctx.yes && !ctx.dryRun && isPerson(ctx);
  const plan = enginePlan(ctx.runtime, root, confirmed);
  const human = [...(result.human ?? []), ...engineLines(ctx.t, plan, confirmed)];
  return result.ok ? { ...result, data: { ...result.data, look: plan }, human } : { ...result, human };
};

const sharedAsk = (ctx: Ctx): (() => AskLine) => {
  let reader: AskLine | undefined;
  return () => {
    reader ??= lineReader(ctx.io.stdin);
    return reader;
  };
};

export const initCommand: CommandSpec = {
  path: ["init"],
  summaryKey: "command.init.summary",
  usage:
    "finitemonkey init [--commits conventional|free] [--tests <runner>] [--lint <tool>] [--layout <dir>] [--bin <path>] [--marketplace] [--channel stable|next] [--sandbox] [--look-back] [--github] [--look] [--dry-run] [--yes]",
  status: "ready",
  options: {
    commits: { type: "string" },
    bin: { type: "string" },
    marketplace: { type: "boolean" },
    channel: { type: "string" },
    sandbox: { type: "boolean" },
    "look-back": { type: "boolean" },
    github: { type: "boolean" },
    look: { type: "boolean" },
    tests: { type: "string" },
    lint: { type: "string" },
    layout: { type: "string" },
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
    const channel = stringOption(args.values, "channel");
    if (channel !== undefined && parseChannel(channel) === undefined)
      return failureFrom(
        ctx.t,
        usageProblem("invalid_arguments", "error.invalid_arguments", "finitemonkey init --marketplace --channel next", {
          detail: channel,
        }),
      );
    const conventions = conventionFlags(ctx, args);
    if (!conventions.ok) return conventions.result;
    const ask = sharedAsk(ctx);
    const commits = await commitsAnswer(ctx, flag, () => ask()());
    const answers = await conventionAnswers(ctx, conventions.flags, ask);
    const result = runInstall(ctx, initRequest(args, commits, answers));
    const looked = args.values["look-back"] === true ? withLookBack(ctx, result) : result;
    const hubbed = args.values["github"] === true ? withGithub(ctx, looked) : looked;
    return args.values["look"] === true ? withLook(ctx, hubbed) : hubbed;
  },
};
