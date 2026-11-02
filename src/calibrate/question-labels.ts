import type { Runtime } from "../core/runtime.js";
import { logEntries } from "../knowledge/instruction-arms.js";
import type { FmPaths } from "../task/paths.js";
import type { Label } from "./labels.js";

export const QUESTION_EVENT = "divergence.outcome";
export const ANSWER_EVENT = "divergence.answered";

export type QuestionLabel = "needed" | "not_needed";

export interface QuestionCounts {
  readonly needed: number;
  readonly notNeeded: number;
}

export const dismissedQuestions = (runtime: Pick<Runtime, "readText">, paths: FmPaths): ReadonlySet<string> => {
  const asked = new Set<string>();
  const answered = new Set<string>();
  for (const entry of logEntries(runtime, paths, [QUESTION_EVENT, ANSWER_EVENT])) {
    const task = entry["task"];
    if (typeof task !== "string") continue;
    if (entry["event"] === ANSWER_EVENT) answered.add(task);
    else if (entry["kind"] === "question" && entry["mode"] === "active") asked.add(task);
  }
  return new Set([...asked].filter((task) => !answered.has(task)));
};

export const questionLabelOf = (label: Label): QuestionLabel | undefined => {
  if (label.why.includes("reverted")) return "needed";
  return label.bad ? undefined : "not_needed";
};

export const questionLabels = (
  labels: readonly Label[],
  dismissed: ReadonlySet<string>,
): ReadonlyMap<string, QuestionLabel> =>
  new Map(
    labels.flatMap((label): [string, QuestionLabel][] => {
      const found = dismissed.has(label.task) ? questionLabelOf(label) : undefined;
      return found === undefined ? [] : [[label.task, found]];
    }),
  );

export const questionCounts = (found: ReadonlyMap<string, QuestionLabel>): QuestionCounts => {
  const values = [...found.values()];
  return {
    needed: values.filter((value) => value === "needed").length,
    notNeeded: values.filter((value) => value === "not_needed").length,
  };
};

export const sampleTarget = (label: Label, question: QuestionLabel | undefined): 0 | 1 => {
  if (question === "needed") return 1;
  if (question === "not_needed") return 0;
  return label.bad ? 1 : 0;
};
