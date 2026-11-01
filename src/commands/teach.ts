import { listOption, stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import type { MessageKey } from "../i18n/catalogs.js";
import { isPerson } from "../secrets/project.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import {
  answerQuestion,
  askQuestion,
  explain,
  openQuestion,
  skipQuestion,
  type TeachDeps,
  type TeachOutcome,
  viewOf,
} from "../teach/flow.js";
import { questionLines } from "../teach/lines.js";
import { teachOptedIn } from "../teach/opt-in.js";
import { questionsIn, readTeach } from "../teach/store.js";
import { TEACH_SCHEMA, type TeachOrigin } from "../teach/types.js";
import { inGuardianRepo } from "./guardian.js";
import { numberOptions } from "./judge-deps.js";
import type { CommandSpec, OptionValues } from "./types.js";

const USAGE = "finitemonkey teach";
const ASK_USAGE = "finitemonkey teach ask --concepts <a,b> [--edge] [--session <id>]";
const KNOW_USAGE = "finitemonkey teach know --concepts <a,b>";
const ANSWER_USAGE = "finitemonkey teach answer <question> <value>";
const SKIP_USAGE = "finitemonkey teach skip <question>";
const EXPLAIN_USAGE = "finitemonkey teach explain --concepts <a,b> [--question <id>] <text>";

const REFUSED: ReadonlySet<string> = new Set(["unknown_question", "answered", "write_failed"]);

const optedIn = (ctx: Ctx, usage: string, run: (paths: FmPaths) => CommandResult): Promise<CommandResult> =>
  inGuardianRepo(ctx, (root) => {
    const paths = fmPaths(root);
    if (!teachOptedIn(ctx.runtime, paths))
      return failureFrom(ctx.t, usageProblem("invalid_arguments", "teach.opt_in", usage));
    return run(paths);
  });

const depsOf = (ctx: Ctx, paths: FmPaths): TeachDeps => ({
  runtime: ctx.runtime,
  paths,
  locale: numberOptions(ctx, paths).locale,
});

const concepts = (values: OptionValues): readonly string[] =>
  listOption(values, "concepts").flatMap((item) =>
    item
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== ""),
  );

const reported = (ctx: Ctx, paths: FmPaths, outcome: TeachOutcome, usage: string): CommandResult => {
  if (outcome.ok) {
    logEvent(ctx.runtime, paths, "teach.result", {
      question: outcome.view.question,
      answered: outcome.view.answered,
      ...(outcome.view.correct === undefined ? {} : { correct: outcome.view.correct }),
    });
    return success({ schema: TEACH_SCHEMA, question: outcome.view }, questionLines(ctx.t, outcome.view));
  }
  if (REFUSED.has(outcome.reason))
    return failureFrom(ctx.t, usageProblem("invalid_arguments", `teach.reason.${outcome.reason}` as MessageKey, usage));
  return success({ schema: TEACH_SCHEMA, question: null, reason: outcome.reason }, [
    ctx.t(`teach.reason.${outcome.reason}` as MessageKey),
  ]);
};

const ask = (ctx: Ctx, values: OptionValues, origin: TeachOrigin, usage: string): Promise<CommandResult> =>
  optedIn(ctx, usage, (paths) => {
    const session = stringOption(values, "session") ?? ctx.env["CLAUDE_SESSION_ID"];
    const outcome = askQuestion(depsOf(ctx, paths), {
      concepts: concepts(values),
      origin,
      ...(session === undefined ? {} : { session }),
    });
    return reported(ctx, paths, outcome, usage);
  });

const answer = (ctx: Ctx, positionals: readonly string[]): Promise<CommandResult> =>
  optedIn(ctx, ANSWER_USAGE, (paths) => {
    const [id, value] = positionals;
    if (id === undefined || value === undefined || value.trim() === "")
      return failureFrom(
        ctx.t,
        usageProblem("invalid_arguments", "error.invalid_arguments", ANSWER_USAGE, { detail: "answer" }),
      );
    if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("teach.person_only", ANSWER_USAGE));
    return reported(ctx, paths, answerQuestion(depsOf(ctx, paths), id, value), ANSWER_USAGE);
  });

const skip = (ctx: Ctx, id: string | undefined): Promise<CommandResult> =>
  optedIn(ctx, SKIP_USAGE, (paths) => {
    if (id === undefined)
      return failureFrom(
        ctx.t,
        usageProblem("invalid_arguments", "error.invalid_arguments", SKIP_USAGE, { detail: "question" }),
      );
    const outcome = skipQuestion(depsOf(ctx, paths), id);
    if (!outcome.ok) return reported(ctx, paths, outcome, SKIP_USAGE);
    return success({ schema: TEACH_SCHEMA, question: outcome.view }, [ctx.t("teach.skipped", { id })]);
  });

const explained = (ctx: Ctx, values: OptionValues, text: string | undefined): Promise<CommandResult> =>
  optedIn(ctx, EXPLAIN_USAGE, (paths) => {
    const about = concepts(values);
    if (text === undefined || text.trim() === "" || about.length === 0)
      return failureFrom(
        ctx.t,
        usageProblem("invalid_arguments", "error.invalid_arguments", EXPLAIN_USAGE, { detail: "text" }),
      );
    const question = stringOption(values, "question");
    if (!explain({ runtime: ctx.runtime, paths }, about, text.trim(), isPerson(ctx) ? "terminal" : "session", question))
      return failureFrom(ctx.t, usageProblem("invalid_arguments", "teach.reason.write_failed", EXPLAIN_USAGE));
    return success({ schema: TEACH_SCHEMA, explained: about }, [
      ctx.t("teach.explained", { concepts: about.join(", ") }),
    ]);
  });

const show = (ctx: Ctx): Promise<CommandResult> =>
  optedIn(ctx, USAGE, (paths) => {
    const entries = readTeach(ctx.runtime, paths);
    const count = (type: "answer" | "skip" | "explanation"): number =>
      entries.filter((entry) => entry.type === type).length;
    const counts = {
      asked: questionsIn(entries).length,
      answered: count("answer"),
      skipped: count("skip"),
      explained: count("explanation"),
    };
    const open = openQuestion(entries);
    const view = open === undefined ? null : viewOf(open, entries);
    return success({ schema: TEACH_SCHEMA, question: view, counts }, [
      ctx.t("teach.counts", counts),
      ...(view === null ? [] : questionLines(ctx.t, view)),
    ]);
  });

const spec = (
  path: readonly string[],
  summaryKey: MessageKey,
  usage: string,
  rest: Pick<CommandSpec, "run"> & Partial<Pick<CommandSpec, "options" | "maxPositionals">>,
): CommandSpec => ({ path: ["teach", ...path], summaryKey, usage, status: "ready", maxPositionals: 0, ...rest });

const ASK_OPTIONS = {
  concepts: { type: "string", multiple: true },
  edge: { type: "boolean" },
  session: { type: "string" },
} as const;

export const TEACH_COMMANDS: readonly CommandSpec[] = [
  spec([], "command.teach.summary", USAGE, { run: (ctx) => show(ctx) }),
  spec(["ask"], "command.teach_ask.summary", ASK_USAGE, {
    options: ASK_OPTIONS,
    run: (ctx, args) => ask(ctx, args.values, args.values["edge"] === true ? "edge" : "predict", ASK_USAGE),
  }),
  spec(["know"], "command.teach_know.summary", KNOW_USAGE, {
    options: { concepts: { type: "string", multiple: true } },
    run: (ctx, args) => ask(ctx, args.values, "know", KNOW_USAGE),
  }),
  spec(["answer"], "command.teach_answer.summary", ANSWER_USAGE, {
    maxPositionals: 2,
    run: (ctx, args) => answer(ctx, args.positionals),
  }),
  spec(["skip"], "command.teach_skip.summary", SKIP_USAGE, {
    maxPositionals: 1,
    run: (ctx, args) => skip(ctx, args.positionals[0]),
  }),
  spec(["explain"], "command.teach_explain.summary", EXPLAIN_USAGE, {
    maxPositionals: 1,
    options: { concepts: { type: "string", multiple: true }, question: { type: "string" } },
    run: (ctx, args) => explained(ctx, args.values, args.positionals[0]),
  }),
];
