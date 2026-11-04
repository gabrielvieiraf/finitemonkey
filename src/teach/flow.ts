import { recordConceptEvents } from "../conceitos/evidence.js";
import { probeFor } from "../conceitos/predict.js";
import type { Runtime } from "../core/runtime.js";
import { conceptBand } from "../judge/band.js";
import type { NumberLocale } from "../judge/numbers.js";
import { entryId, readEntries } from "../judge/store.js";
import type { FmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import { keyedQuestion, sameAnswer } from "./key.js";
import { appendTeach, questionsIn, readTeach, settledOf } from "./store.js";
import type {
  ExplainedFrom,
  InputProposer,
  QuestionView,
  TeachEntry,
  TeachOrigin,
  TeachQuestion,
  TeachTemplate,
} from "./types.js";

export type TeachRuntime = Pick<Runtime, "readText" | "appendText" | "mkdir" | "exec" | "now">;

export interface TeachDeps {
  readonly runtime: TeachRuntime;
  readonly paths: FmPaths;
  readonly proposer?: InputProposer;
  readonly locale?: NumberLocale;
}

export type TeachOutcome =
  { readonly ok: true; readonly view: QuestionView } | { readonly ok: false; readonly reason: string };

export interface AskRequest {
  readonly concepts: readonly string[];
  readonly origin: TeachOrigin;
  readonly session?: string;
}

const EDGE_BANDS: ReadonlySet<string> = new Set(["proximal", "beyond"]);

export const edgeConcepts = (
  deps: Pick<TeachDeps, "runtime" | "paths">,
  concepts: readonly string[],
): readonly string[] => {
  const entries = readEntries(deps.runtime, deps.paths);
  return concepts.filter((concept) => EDGE_BANDS.has(conceptBand(concept, entries).band));
};

export const templateFor = (runtime: Pick<Runtime, "readText">, paths: FmPaths): TeachTemplate | undefined => {
  const task = readState(runtime, paths).active;
  return task === undefined ? undefined : probeFor(runtime, paths, task);
};

export const viewOf = (question: TeachQuestion, entries: readonly TeachEntry[]): QuestionView => {
  const settled = settledOf(question.id, entries);
  const answered = settled?.type === "answer";
  return {
    question: question.id,
    concepts: question.concepts,
    run: question.run,
    input: question.input,
    origin: question.origin,
    answered,
    ...(answered ? { correct: settled.correct, actual: question.key } : {}),
  };
};

export const openQuestion = (entries: readonly TeachEntry[]): TeachQuestion | undefined =>
  questionsIn(entries).find((question) => settledOf(question.id, entries) === undefined);

export const askQuestion = (deps: TeachDeps, request: AskRequest): TeachOutcome => {
  if (request.concepts.length === 0) return { ok: false, reason: "no_concept" };
  const concepts = request.origin === "edge" ? edgeConcepts(deps, request.concepts) : request.concepts;
  if (concepts.length === 0) return { ok: false, reason: "not_at_edge" };
  const entries = readTeach(deps.runtime, deps.paths);
  const open = openQuestion(entries);
  if (open !== undefined) return { ok: true, view: viewOf(open, entries) };
  const template = templateFor(deps.runtime, deps.paths);
  const keyed =
    template === undefined
      ? undefined
      : keyedQuestion(deps.runtime, deps.paths.root, template, concepts, deps.proposer);
  if (keyed === undefined) return { ok: false, reason: "no_key" };
  const at = deps.runtime.now();
  const task = readState(deps.runtime, deps.paths).active;
  const question: TeachQuestion = {
    type: "question",
    id: entryId("t", concepts.join(","), keyed.input, at),
    at,
    concepts,
    ...keyed,
    origin: request.origin,
    ...(task === undefined ? {} : { task }),
    ...(request.session === undefined ? {} : { session: request.session }),
  };
  if (!appendTeach(deps.runtime, deps.paths, question)) return { ok: false, reason: "write_failed" };
  return { ok: true, view: viewOf(question, [question]) };
};

const recordExplanation = (deps: TeachDeps, question: TeachQuestion, correct: boolean): void => {
  recordConceptEvents(
    deps.runtime,
    deps.paths,
    question.concepts.map((concept) => ({
      concept,
      kind: correct ? "explanation_right" : "explanation_wrong",
      origin: "person",
      ...(question.task === undefined ? {} : { task: question.task }),
      match: `teach:${question.id}`,
    })),
  );
};

const pending = (deps: TeachDeps, id: string): TeachQuestion | string => {
  const entries = readTeach(deps.runtime, deps.paths);
  const question = questionsIn(entries).find((item) => item.id === id);
  if (question === undefined) return "unknown_question";
  return settledOf(id, entries) === undefined ? question : "answered";
};

export const answerQuestion = (deps: TeachDeps, id: string, answer: string): TeachOutcome => {
  const question = pending(deps, id);
  if (typeof question === "string") return { ok: false, reason: question };
  const correct = sameAnswer(answer, question.key, deps.locale);
  const at = deps.runtime.now();
  const record: TeachEntry = { type: "answer", id: entryId("a", id, at), at, question: id, answer, correct };
  if (!appendTeach(deps.runtime, deps.paths, record)) return { ok: false, reason: "write_failed" };
  recordExplanation(deps, question, correct);
  return { ok: true, view: viewOf(question, [question, record]) };
};

export const skipQuestion = (deps: TeachDeps, id: string): TeachOutcome => {
  const question = pending(deps, id);
  if (typeof question === "string") return { ok: false, reason: question };
  const at = deps.runtime.now();
  const record: TeachEntry = { type: "skip", id: entryId("k", id, at), at, question: id };
  if (!appendTeach(deps.runtime, deps.paths, record)) return { ok: false, reason: "write_failed" };
  return { ok: true, view: viewOf(question, [question, record]) };
};

export const explain = (
  deps: Pick<TeachDeps, "runtime" | "paths">,
  concepts: readonly string[],
  text: string,
  from: ExplainedFrom,
  question?: string,
): boolean => {
  const at = deps.runtime.now();
  return appendTeach(deps.runtime, deps.paths, {
    type: "explanation",
    id: entryId("x", concepts.join(","), text, at),
    at,
    concepts,
    text,
    from,
    ...(question === undefined ? {} : { question }),
  });
};
