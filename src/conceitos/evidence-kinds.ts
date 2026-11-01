import type { ConceptId } from "./concepts.js";

export const EVENT_KINDS = [
  "exposure",
  "prediction_right",
  "prediction_wrong",
  "own_change",
  "own_repair",
  "failure_after_approval",
  "check_right",
  "check_wrong",
] as const;

export type ConceptEventKind = (typeof EVENT_KINDS)[number];
export type Origin = "person" | "agent";

export const WEIGHTS: Readonly<Record<ConceptEventKind, number>> = {
  exposure: 0,
  prediction_right: 1,
  prediction_wrong: -1,
  own_change: 1,
  own_repair: 1.5,
  failure_after_approval: -1,
  check_right: 1,
  check_wrong: -0.5,
};

const PERSON_ONLY: ReadonlySet<ConceptEventKind> = new Set([
  "prediction_right",
  "own_change",
  "own_repair",
  "check_right",
]);

export interface ConceptEventDraft {
  readonly concept: ConceptId;
  readonly kind: ConceptEventKind;
  readonly origin: Origin;
  readonly task?: string;
  readonly file?: string;
}

export interface ConceptEvent extends ConceptEventDraft {
  readonly at: string;
  readonly weight: number;
}

export const settled = (draft: ConceptEventDraft): ConceptEventDraft =>
  draft.origin === "agent" && PERSON_ONLY.has(draft.kind) ? { ...draft, kind: "exposure" } : draft;
