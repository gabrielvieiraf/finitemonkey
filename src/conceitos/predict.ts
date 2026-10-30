import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import { projectPaths } from "../gate/hooks/common.js";
import { deny, FILE_TOOLS, grantFor } from "../guards/context.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookHandler, HookHandlers } from "../hooks/handlers.js";
import { readProfile } from "../perfil/store.js";
import { levelOf } from "../perfil/types.js";
import { readPending } from "../ricochete/divergence.js";
import { approvedExamples } from "../task/examples.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, readState, writeJsonFile } from "../task/state.js";
import { type Book, readBook, writeBook } from "./book.js";
import { type ConceptId, conceptsIn, domainOf, parseConcept } from "./concepts.js";
import { recordConceptEvents } from "./evidence.js";

export const PREDICT_FEATURE = "predict-gate";
export const DEMONSTRATED_AFTER = 3;
const PREDICTIONS_FILE = "predictions.json";

export interface Probe {
  readonly run: string;
  readonly input: string;
}

export interface Prediction {
  readonly concept: ConceptId;
  readonly task: string;
  readonly output: string;
  readonly probe: Probe;
  readonly at: string;
}

interface PredictState {
  readonly asked: Readonly<Partial<Record<ConceptId, Probe & { readonly task: string }>>>;
  readonly predictions: readonly Prediction[];
}

const probeOf = (value: unknown): Probe | undefined =>
  isRecord(value) && typeof value["run"] === "string" && typeof value["input"] === "string"
    ? { run: value["run"], input: value["input"] }
    : undefined;

export const readPredictions = (runtime: Pick<Runtime, "readText">, paths: FmPaths): PredictState => {
  const raw = readJsonFile(runtime, paths.cache(PREDICTIONS_FILE));
  const asked = isRecord(raw?.["asked"]) ? raw["asked"] : {};
  const list = Array.isArray(raw?.["predictions"]) ? raw["predictions"] : [];
  return {
    asked: Object.fromEntries(
      Object.entries(asked).flatMap(([key, value]) => {
        const concept = parseConcept(key);
        const probe = probeOf(value);
        const task = isRecord(value) ? value["task"] : undefined;
        return concept === undefined || probe === undefined || typeof task !== "string"
          ? []
          : [[concept, { ...probe, task }]];
      }),
    ),
    predictions: list.flatMap((item: unknown): Prediction[] => {
      if (!isRecord(item)) return [];
      const concept = parseConcept(typeof item["concept"] === "string" ? item["concept"] : undefined);
      const probe = probeOf(item["probe"]);
      const { task, output, at } = item;
      return concept === undefined || probe === undefined || typeof task !== "string" || typeof output !== "string"
        ? []
        : [{ concept, task, output, probe, at: typeof at === "string" ? at : "" }];
    }),
  };
};

const writePredictions = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, state: PredictState): void => {
  writeJsonFile(runtime, paths.cache(PREDICTIONS_FILE), {
    asked: Object.fromEntries(Object.entries(state.asked).map(([key, value]) => [key, { ...value }])),
    predictions: state.predictions.map((item) => ({ ...item, probe: { ...item.probe } })),
  });
};

export const probeFor = (runtime: Pick<Runtime, "readText">, paths: FmPaths, task: string): Probe | undefined => {
  const question = readPending(runtime, paths).pending[task];
  if (question !== undefined) return { run: question.run, input: question.input };
  const first = approvedExamples(runtime, paths, task).examples[0];
  return first === undefined ? undefined : { run: first.run, input: first.input ?? "" };
};

const isBeginner = (runtime: Pick<Runtime, "readText" | "now">, paths: FmPaths, concept: ConceptId): boolean => {
  const profile = readProfile(runtime, paths);
  return profile !== undefined && levelOf(profile.domains[domainOf(concept)].knowledge) === "beginner";
};

export const isDemonstrated = (book: Book, concept: ConceptId): boolean =>
  book.concepts[concept]?.demonstrated === true;

const editedText = (raw: Parameters<HookHandler>[0]["payload"]["raw"]): string => {
  const args = toolInput(raw);
  const edits = isRecord(args) && Array.isArray(args["edits"]) ? args["edits"] : [];
  return [
    textField(args, "content", "new_string", "new_source") ?? "",
    ...edits.map((edit: unknown) => (isRecord(edit) ? (textField(edit, "new_string") ?? "") : "")),
  ].join("\n");
};

const allow = { kind: "allow" } as const;

export const predictGuard: HookHandler = (input) => {
  if (!FILE_TOOLS.has(toolName(input.payload.raw))) return allow;
  const paths = projectPaths(input);
  if (paths === undefined) return allow;
  const { runtime, t } = input;
  const task = readState(runtime, paths).active;
  if (task === undefined) return allow;
  const book = readBook(runtime, paths);
  const state = readPredictions(runtime, paths);
  const waiting = conceptsIn(editedText(input.payload.raw)).filter(
    (concept) =>
      !isDemonstrated(book, concept) &&
      !state.predictions.some((item) => item.concept === concept && item.task === task) &&
      isBeginner(runtime, paths, concept),
  );
  const concept = waiting[0];
  if (concept === undefined) return allow;
  const probe = probeFor(runtime, paths, task);
  if (probe === undefined) return allow;
  if (grantFor(input, "predict") !== undefined) {
    logEvent(runtime, paths, "predict.skipped", { concept, task });
    return allow;
  }
  writePredictions(runtime, paths, { ...state, asked: { ...state.asked, [concept]: { ...probe, task } } });
  logEvent(runtime, paths, "predict.asked", { concept, task });
  const params = { concept, input: probe.input || "-", run: probe.run };
  return deny(t("predict.reason", params), t("predict.human", params));
};

export const PREDICT_HANDLERS: HookHandlers = { PreToolUse: [predictGuard] };

export const recordPrediction = (
  runtime: Pick<Runtime, "readText" | "writeText" | "now">,
  paths: FmPaths,
  concept: ConceptId,
  output: string,
): Prediction | undefined => {
  const state = readPredictions(runtime, paths);
  const active = readState(runtime, paths).active;
  const volunteered = active === undefined ? undefined : probeFor(runtime, paths, active);
  const asked =
    state.asked[concept] ??
    (active === undefined || volunteered === undefined ? undefined : { ...volunteered, task: active });
  if (asked === undefined) return undefined;
  const prediction: Prediction = {
    concept,
    task: asked.task,
    output,
    probe: { run: asked.run, input: asked.input },
    at: runtime.now(),
  };
  const rest = Object.fromEntries(Object.entries(state.asked).filter(([key]) => key !== concept));
  writePredictions(runtime, paths, { asked: rest, predictions: [...state.predictions, prediction] });
  return prediction;
};

export interface Settled {
  readonly prediction: Prediction;
  readonly actual: string;
  readonly correct: boolean;
  readonly demonstrated: boolean;
}

const scored = (book: Book, concept: ConceptId, correct: boolean, at: string): Book => {
  const before = book.concepts[concept];
  const streak = correct ? (before?.streak ?? 0) + 1 : 0;
  const demonstrated = correct && streak >= DEMONSTRATED_AFTER;
  return {
    ...book,
    concepts: {
      ...book.concepts,
      [concept]: {
        level: before?.level ?? "seen",
        updatedAt: at,
        streak,
        ...(demonstrated || (correct && before?.demonstrated === true) ? { demonstrated: true } : {}),
      },
    },
  };
};

export const settlePredictions = (
  runtime: Pick<Runtime, "readText" | "writeText" | "appendText" | "now">,
  paths: FmPaths,
  task: string,
  observe: (probe: Probe) => string | undefined,
): readonly Settled[] => {
  const state = readPredictions(runtime, paths);
  const mine = state.predictions.filter((item) => item.task === task);
  if (mine.length === 0) return [];
  let book = readBook(runtime, paths);
  const settled = mine.flatMap((prediction): Settled[] => {
    const actual = observe(prediction.probe);
    if (actual === undefined) return [];
    const correct = actual === prediction.output.trim();
    book = scored(book, prediction.concept, correct, runtime.now());
    logEvent(runtime, paths, "predict.result", { concept: prediction.concept, task, correct });
    recordConceptEvents(runtime, paths, [
      { concept: prediction.concept, kind: correct ? "prediction_right" : "prediction_wrong", origin: "person", task },
    ]);
    return [{ prediction, actual, correct, demonstrated: isDemonstrated(book, prediction.concept) }];
  });
  writeBook(runtime, paths, book);
  const done = new Set(settled.map((item) => item.prediction));
  writePredictions(runtime, paths, { ...state, predictions: state.predictions.filter((item) => !done.has(item)) });
  return settled;
};

export const revokeDemonstrated = (
  runtime: Pick<Runtime, "readText" | "writeText" | "appendText" | "now">,
  paths: FmPaths,
  concepts: readonly ConceptId[],
): readonly ConceptId[] => {
  const book = readBook(runtime, paths);
  const revoked = concepts.filter((concept) => isDemonstrated(book, concept));
  if (revoked.length === 0) return [];
  const next = revoked.reduce((current, concept) => scored(current, concept, false, runtime.now()), book);
  writeBook(runtime, paths, next);
  logEvent(runtime, paths, "predict.revoked", { concepts: [...revoked] });
  return revoked;
};
