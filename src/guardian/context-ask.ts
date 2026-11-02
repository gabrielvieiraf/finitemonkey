import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { readLevel } from "../infra/file.js";
import { readOwnership } from "../ownership/file.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import type { CompanyContext } from "./context.js";

export const CONTEXT_QUESTIONS = ["stage", "cost", "deploy", "maintains"] as const;
export type ContextQuestion = (typeof CONTEXT_QUESTIONS)[number];

const ASKED_FILE = "guardian-context.json";

export interface AskedContext {
  readonly asked: readonly ContextQuestion[];
  readonly answered: readonly ContextQuestion[];
}

const questionsIn = (value: unknown): readonly ContextQuestion[] =>
  Array.isArray(value) ? CONTEXT_QUESTIONS.filter((question) => value.includes(question)) : [];

const ownerKnown = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): boolean => {
  const ownership = readOwnership(runtime, root);
  return ownership?.ok === true && ownership.value.components.some((component) => component.owner !== "");
};

export const missingContext = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
  context: CompanyContext,
): readonly ContextQuestion[] =>
  CONTEXT_QUESTIONS.filter((question) => {
    if (question === "stage") return context.stage?.origin !== "stated";
    if (question === "deploy") return context.deploy === undefined && readLevel(runtime, root) === undefined;
    if (question === "maintains") return context.maintains === undefined && !ownerKnown(runtime, root);
    return context.cost === undefined;
  });

export const askedContext = (runtime: Pick<Runtime, "readText">, paths: FmPaths): AskedContext | undefined => {
  const raw = readJsonFile(runtime, paths.cache(ASKED_FILE));
  return raw === undefined ? undefined : { asked: questionsIn(raw["asked"]), answered: questionsIn(raw["answered"]) };
};

export const writeAsked = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, state: AskedContext): void => {
  writeJsonFile(runtime, paths.cache(ASKED_FILE), { asked: [...state.asked], answered: [...state.answered] });
};
