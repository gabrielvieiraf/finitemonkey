import type { ConceptId } from "./concepts.js";
import type { RecognitionSource } from "./recognize.js";

export const EVENT_KINDS = [
  "exposure",
  "prediction_right",
  "prediction_wrong",
  "own_change",
  "own_repair",
  "failure_after_approval",
  "check_right",
  "check_wrong",
  "explanation_right",
  "explanation_wrong",
] as const;

export type ConceptEventKind = (typeof EVENT_KINDS)[number];
export const ORIGINS = ["person", "agent", "model-proposed"] as const;
export type Origin = (typeof ORIGINS)[number];

export const WEIGHTS: Readonly<Record<ConceptEventKind, number>> = {
  exposure: 0,
  prediction_right: 1,
  prediction_wrong: -1,
  own_change: 1,
  own_repair: 1.5,
  failure_after_approval: -1,
  check_right: 1,
  check_wrong: -0.5,
  explanation_right: 1,
  explanation_wrong: -1,
};

const PERSON_ONLY: ReadonlySet<ConceptEventKind> = new Set([
  "prediction_right",
  "own_change",
  "own_repair",
  "check_right",
  "explanation_right",
]);

export interface ConceptEventDraft {
  readonly concept: ConceptId;
  readonly kind: ConceptEventKind;
  readonly origin: Origin;
  readonly task?: string;
  readonly file?: string;
  readonly source?: RecognitionSource;
  readonly match?: string;
}

export interface ConceptEvent extends ConceptEventDraft {
  readonly at: string;
  readonly weight: number;
}

export const settled = (draft: ConceptEventDraft): ConceptEventDraft => {
  if (draft.origin === "model-proposed") return { ...draft, kind: "exposure", source: "model-proposed" };
  return draft.origin === "agent" && PERSON_ONLY.has(draft.kind) ? { ...draft, kind: "exposure" } : draft;
};
