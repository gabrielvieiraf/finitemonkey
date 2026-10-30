import { join } from "node:path";

import { stringOption } from "../core/args.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import {
  beginnerIn,
  commandSource,
  DIVERGENCE_FEATURE,
  divergenceConfig,
  eligible,
  findDivergence,
  type Outcome,
  type Question,
  readPending,
  writePending,
} from "../ricochete/divergence.js";
import { domainOfText, recordHorizon } from "../signals/blind-band.js";
import { decideExamples, MAX_EXAMPLES, proposeExample } from "../task/examples.js";
import { contractHash, type LoadedContract, loadTask } from "../task/load.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import { TASK_SCHEMA } from "../task/types.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

const USAGE = "finitemonkey task diverge [<id>] [--choose <letter> | --want <output> | --pending]";

const load = (ctx: Ctx, paths: FmPaths, task: string): LoadedContract | undefined => {
  const disk = (relative: string): string | undefined => {
    const text = ctx.runtime.readText(toAbsolutePath(join(paths.root, relative)));
    return text.ok ? text.value : undefined;
  };
  const loaded = loadTask(ctx.runtime, paths, { disk, base: () => undefined }, task);
  return loaded.ok ? loaded.value : undefined;
};

type SkipReason = "off" | "small" | "no_examples" | "budget" | "no_generator" | "generator_failed";

const skipped = (ctx: Ctx, task: string, reason: SkipReason): CommandResult =>
  success({ schema: TASK_SCHEMA, task, outcome: "skipped", reason }, [
    ctx.t("divergence.skipped", { task, reason: ctx.t(`divergence.reason.${reason}`) }),
  ]);

export const questionLines = (ctx: Ctx, question: Question): readonly string[] => [
  ctx.t("divergence.question", {
    input: question.input,
    a: question.options[0]?.output ?? "-",
    b: question.options[1]?.output ?? "-",
  }),
  ...question.options.map((option) => ctx.t("divergence.option", { letter: option.letter, output: option.output })),
  ctx.t("divergence.choose", { task: question.task }),
];

const report = (ctx: Ctx, paths: FmPaths, task: string, outcome: Outcome, mode: string): CommandResult => {
  logEvent(ctx.runtime, paths, "divergence.outcome", { task, mode, kind: outcome.kind });
  const data = { schema: TASK_SCHEMA, task, mode, outcome: outcome.kind };
  if (outcome.kind === "no_change") return success({ ...data }, [ctx.t("divergence.no_change", { task })]);
  if (outcome.kind === "agree")
    return success({ ...data, readings: outcome.readings, inputs: outcome.inputs }, [
      ctx.t("divergence.agree", { readings: outcome.readings, inputs: outcome.inputs }),
    ]);
  if (outcome.kind === "too_few")
    return success({ ...data, readings: outcome.readings }, [
      ctx.t("divergence.too_few", { readings: outcome.readings }),
    ]);
  const question = outcome.question;
  if (mode !== "active") {
    recordFeatureShadow(ctx.runtime, paths, DIVERGENCE_FEATURE, { task, input: question.input });
    return success({ ...data, question }, [ctx.t("divergence.shadow", { task })]);
  }
  const state = readPending(ctx.runtime, paths);
  writePending(ctx.runtime, paths, { ...state, pending: { ...state.pending, [task]: question } });
  recordHorizon(ctx.runtime, paths, {
    source: "divergence",
    criterion: "example",
    domain: domainOfText(`${question.input} ${question.options.map((option) => option.output).join(" ")}`),
    task,
  });
  return {
    ...success({ ...data, question }, questionLines(ctx, question)),
    next: `finitemonkey task diverge ${task} --choose A`,
  };
};

const ask = (ctx: Ctx, paths: FmPaths, task: string): CommandResult => {
  const mode = featureMode(ctx.runtime, paths, DIVERGENCE_FEATURE);
  if (mode === "off") return skipped(ctx, task, "off");
  const loaded = load(ctx, paths, task);
  if (loaded === undefined)
    return failureFrom(ctx.t, usageProblem("task_not_found", "error.task_not_found", USAGE, { task }));
  const examples = loaded.examples ?? [];
  const why = eligible(loaded.contract, examples);
  if (why !== undefined) return skipped(ctx, task, why);
  const config = divergenceConfig(ctx.runtime, paths.root);
  const state = readPending(ctx.runtime, paths);
  const used = state.rounds[task] ?? 0;
  if (used >= config.rounds) return skipped(ctx, task, "budget");
  if (config.generator === undefined) return skipped(ctx, task, "no_generator");
  writePending(ctx.runtime, paths, { ...state, rounds: { ...state.rounds, [task]: used + 1 } });
  const candidates = commandSource(ctx.runtime, paths.root, config.generator).generate({
    task,
    goal: loaded.contract.goal,
    readings: config.readings,
    examples,
  });
  if (candidates === undefined) return skipped(ctx, task, "generator_failed");
  const outcome = findDivergence({
    runtime: ctx.runtime,
    root: paths.root,
    task,
    examples,
    candidates: { ...candidates, readings: candidates.readings.slice(0, config.readings) },
    beginner: beginnerIn(ctx.runtime, paths),
  });
  return report(ctx, paths, task, outcome, mode);
};

const pendingOf = (ctx: Ctx, paths: FmPaths, task: string): CommandResult => {
  const question = readPending(ctx.runtime, paths).pending[task];
  if (question === undefined)
    return success({ schema: TASK_SCHEMA, task, question: null }, [ctx.t("divergence.none", { task })]);
  return success({ schema: TASK_SCHEMA, task, question }, questionLines(ctx, question));
};

type Answer = { readonly letter: string } | { readonly want: string };

const store = (ctx: Ctx, paths: FmPaths, task: string, answer: Answer): CommandResult => {
  const state = readPending(ctx.runtime, paths);
  const question = state.pending[task];
  const option =
    "letter" in answer ? question?.options.find((item) => item.letter === answer.letter.toUpperCase()) : undefined;
  const expect = "want" in answer ? answer.want.trim() : option?.output;
  if (question === undefined || expect === undefined || expect === "")
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "divergence.no_pending", USAGE, {
        task,
        letter: "letter" in answer ? answer.letter : "--want",
      }),
    );
  const loaded = load(ctx, paths, task);
  if (loaded?.trusted !== true)
    return failureFrom(ctx.t, needsPersonProblem("examples.untrusted", `fm: trust ${task}`, { task }));
  const says = ctx.t("divergence.says", { input: question.input, output: expect });
  const made = proposeExample(ctx.runtime, paths, task, { says, run: question.run, input: question.input, expect });
  if (!made.ok)
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", `examples.${made.error}`, USAGE, { task, max: MAX_EXAMPLES }),
    );
  const decided = decideExamples(
    ctx.runtime,
    paths,
    loaded.contract,
    { approve: [made.value.id], reject: [] },
    (contract, examples) => contractHash(contract, examples),
  );
  if (!decided.ok)
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "examples.decide_failed", USAGE, { task, detail: "write" }),
    );
  const rest = Object.fromEntries(Object.entries(state.pending).filter(([key]) => key !== task));
  writePending(ctx.runtime, paths, { ...state, pending: rest });
  logEvent(ctx.runtime, paths, "divergence.answered", {
    task,
    letter: option?.letter ?? null,
    own: option === undefined,
    example: made.value.id,
  });
  return success({ schema: TASK_SCHEMA, task, example: made.value }, [
    ctx.t("divergence.stored", { task, id: made.value.id, says }),
  ]);
};

export const taskDivergeCommand: CommandSpec = {
  path: ["task", "diverge"],
  summaryKey: "command.task_diverge.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { choose: { type: "string" }, want: { type: "string" }, pending: { type: "boolean" } },
  run: (ctx, args): Promise<CommandResult> => {
    const repo = repoOf(ctx);
    if (repo === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const paths = fmPaths(repo.root);
    const task = args.positionals[0] ?? readState(ctx.runtime, paths).active;
    if (task === undefined)
      return Promise.resolve(failureFrom(ctx.t, usageProblem("invalid_arguments", "examples.no_task", USAGE)));
    const letter = stringOption(args.values, "choose");
    const want = stringOption(args.values, "want");
    if (letter !== undefined) return Promise.resolve(store(ctx, paths, task, { letter }));
    if (want !== undefined) return Promise.resolve(store(ctx, paths, task, { want }));
    if (args.values["pending"] === true) return Promise.resolve(pendingOf(ctx, paths, task));
    return Promise.resolve(ask(ctx, paths, task));
  },
};
