import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { YamlValue } from "../core/yaml/scalar.js";
import { logEvent } from "../evidence/log.js";
import { contextOutput, projectPaths } from "../gate/hooks/common.js";
import { comesFromPerson } from "../guards/release/markers.js";
import { textField } from "../hooks/fields.js";
import type { HookHandler, HookHandlers } from "../hooks/handlers.js";
import { catalogs } from "../i18n/catalogs.js";
import { LANGUAGES } from "../i18n/languages.js";
import { featureMode } from "../policy/feature.js";
import type { FmPaths } from "../task/paths.js";
import { STAGES } from "./context.js";
import { askedContext, type ContextQuestion, writeAsked } from "./context-ask.js";
import { readGoals, writeGoals } from "./goals.js";

export const PROPORTION_FEATURE = "proportionality";

const ANSWER = /^\s*[-*]?\s*([\p{L} ]+?)\s*[:=]\s*(.+?)\s*$/u;

const keyFor = (question: ContextQuestion): readonly string[] => [
  question,
  ...LANGUAGES.map((lang) => catalogs[lang][`guardian.context.key.${question}`].toLowerCase()),
];

const valid = (question: ContextQuestion, value: string): boolean =>
  question !== "stage" || STAGES.some((stage) => stage === value.toLowerCase());

export const answersIn = (
  prompt: string,
  asked: readonly ContextQuestion[],
): Readonly<Partial<Record<ContextQuestion, string>>> =>
  Object.fromEntries(
    prompt.split(/\r?\n|;/).flatMap((line) => {
      const match = ANSWER.exec(line);
      const label = (match?.[1] ?? "").trim().toLowerCase();
      const value = (match?.[2] ?? "").trim();
      const question = asked.find((item) => keyFor(item).includes(label));
      return question === undefined || value === "" || !valid(question, value)
        ? []
        : [[question, question === "stage" ? value.toLowerCase() : value]];
    }),
  );

export const noteContextAsked = (
  runtime: Pick<Runtime, "readText" | "writeText" | "appendText" | "now" | "homeDir">,
  paths: FmPaths,
  questions: readonly ContextQuestion[],
): void => {
  if (questions.length === 0 || askedContext(runtime, paths) !== undefined) return;
  const mode = featureMode(runtime, paths, PROPORTION_FEATURE);
  if (mode === "off") return;
  logEvent(runtime, paths, "guardian.context.asked", { questions: [...questions], mode });
  if (mode === "active") writeAsked(runtime, paths, { asked: questions, answered: [] });
};

const stated = (value: string): YamlValue => ({ value, origin: "stated" });

export const contextAnswer: HookHandler = (input) => {
  const prompt = textField(input.payload.raw, "prompt", "prompt_text") ?? "";
  const paths = projectPaths(input);
  if (paths === undefined || prompt.trim() === "" || !comesFromPerson(prompt)) return { kind: "allow" };
  const state = askedContext(input.runtime, paths);
  const open = state?.asked.filter((question) => !state.answered.includes(question)) ?? [];
  if (state === undefined || open.length === 0) return { kind: "allow" };
  const answers = answersIn(prompt, open);
  const given = open.filter((question) => answers[question] !== undefined);
  if (given.length === 0) return { kind: "allow" };
  const goals = readGoals(input.runtime, paths.root);
  const before = goals.extra["context"];
  const previous: Readonly<Record<string, YamlValue>> = isRecord(before) ? before : {};
  const context = {
    ...previous,
    ...Object.fromEntries(given.map((question) => [question, stated(answers[question] ?? "")])),
  };
  if (!writeGoals(input.runtime, paths.root, { ...goals, extra: { ...goals.extra, context } }))
    return { kind: "allow" };
  writeAsked(input.runtime, paths, { asked: state.asked, answered: [...state.answered, ...given] });
  logEvent(input.runtime, paths, "guardian.context.answered", {
    answered: [...given],
    skipped: open.filter((question) => !given.includes(question)),
  });
  return {
    kind: "allow",
    output: contextOutput("UserPromptSubmit", input.t("guardian.context.saved", { list: given.join(", ") })),
  };
};

export const CONTEXT_ANSWER_HANDLERS: HookHandlers = { UserPromptSubmit: [contextAnswer] };
