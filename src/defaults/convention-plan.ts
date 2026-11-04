import type { CommandArgs } from "../core/args.js";
import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom } from "../core/result.js";
import type { ConventionQuestion, PlanData } from "../install/report.js";
import type { ConventionAnswer } from "./convention-question.js";
import { CONVENTION_IDS, CONVENTION_OFF, type Conventions, isConventionValue } from "./conventions.js";

const EXAMPLES = { tests: "vitest", lint: "eslint", layout: "src" } as const;

export type ConventionFlags =
  { readonly ok: true; readonly flags: Conventions } | { readonly ok: false; readonly result: CommandResult };

export const conventionFlags = (ctx: Ctx, args: CommandArgs): ConventionFlags => {
  const flags: Record<string, string> = {};
  for (const id of CONVENTION_IDS) {
    const raw = stringOption(args.values, id);
    if (raw === undefined) continue;
    if (!isConventionValue(raw)) {
      const problem = usageProblem(
        "invalid_arguments",
        "defaults.error.convention",
        `fm init --${id} ${EXAMPLES[id]}`,
        {
          id,
          value: raw,
          example: EXAMPLES[id],
        },
      );
      return { ok: false, result: failureFrom(ctx.t, problem) };
    }
    flags[id] = raw;
  }
  return { ok: true, flags };
};

const questionOf = (answer: ConventionAnswer): ConventionQuestion[] =>
  answer.kind === "given"
    ? []
    : [
        {
          id: answer.detected.id,
          status: answer.kind,
          detected: answer.detected.value,
          evidence: answer.detected.evidence,
          options: [`--${answer.detected.id} ${answer.detected.value}`, `--${answer.detected.id} ${CONVENTION_OFF}`],
        },
      ];

export const withConventionQuestions = (
  ctx: Ctx,
  result: CommandResult<PlanData>,
  answers: readonly ConventionAnswer[],
): CommandResult<PlanData> => {
  const questions = answers.flatMap(questionOf);
  if (questions.length === 0) return result;
  const pending = questions.filter((question) => question.status === "pending");
  const lines = pending.map((question) =>
    ctx.t("defaults.question.convention_pending", {
      id: question.id,
      value: question.detected,
      evidence: question.evidence,
    }),
  );
  const human = [...(result.human ?? []), ...lines];
  if (result.ok) return { ...result, data: { ...result.data, conventionQuestions: questions }, human };
  return result.data === undefined
    ? { ...result, human }
    : { ...result, data: { ...result.data, conventionQuestions: questions }, human };
};
