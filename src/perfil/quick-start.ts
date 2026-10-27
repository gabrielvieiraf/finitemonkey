import type { Ctx } from "../core/context.js";
import { lineReader } from "./lines.js";
import {
  CORRECT_SCORE,
  DOMAIN_QUESTIONS,
  OPTIONS,
  parseOption,
  type Question,
  TOOL_QUESTION,
  TOOL_SCORES,
  WRONG_SCORE,
} from "./questions.js";
import { updateDomain } from "./store.js";
import { DOMAINS, type Profile } from "./types.js";

export const questionLines = (ctx: Pick<Ctx, "t">, question: Question): readonly string[] => [
  ctx.t(question.text),
  ...OPTIONS.map((option) => `  ${option}) ${ctx.t(question.options[option])}`),
];

const STOP = new Set(["q", "quit", "sair", "salir"]);

export type QuickStartOutcome = { readonly kind: "skipped" } | { readonly kind: "done"; readonly profile: Profile };

export const runQuickStart = async (ctx: Ctx, start: Profile): Promise<QuickStartOutcome> => {
  if (ctx.io.stdin.isTTY !== true) return { kind: "skipped" };
  const ask = lineReader(ctx.io.stdin);
  const say = (lines: readonly string[]): void => {
    ctx.io.stderr.write(`${lines.join("\n")}\n`);
  };
  say([ctx.t("perfil.start.intro")]);
  let profile = start;
  let answered = 0;
  for (const domain of DOMAINS) {
    const question = DOMAIN_QUESTIONS[domain];
    say(questionLines(ctx, question));
    const line = (await ask())?.trim().toLowerCase();
    if (line === undefined || STOP.has(line)) break;
    const option = parseOption(line);
    if (option === undefined) continue;
    answered += 1;
    const knowledge = option === question.correct ? CORRECT_SCORE : WRONG_SCORE;
    profile = updateDomain(profile, domain, (entry) => ({ ...entry, knowledge }));
  }
  say(questionLines(ctx, TOOL_QUESTION));
  const tool = parseOption(await ask());
  if (tool !== undefined) {
    answered += 1;
    profile = DOMAINS.reduce(
      (current, domain) => updateDomain(current, domain, (entry) => ({ ...entry, tool: TOOL_SCORES[tool] })),
      profile,
    );
  }
  return answered === 0 ? { kind: "skipped" } : { kind: "done", profile: { ...profile, quickStart: "done" } };
};
