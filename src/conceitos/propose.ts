import { parseConcept } from "./concepts.js";
import type { CodeTouch, Recognition } from "./recognize.js";

export type ConceptProposer = (touch: CodeTouch) => readonly string[] | undefined;

const MAX_PROPOSALS = 3;

export const proposedFor = (proposer: ConceptProposer | undefined, touch: CodeTouch): readonly Recognition[] => {
  if (proposer === undefined) return [];
  let labels: readonly string[] | undefined;
  try {
    labels = proposer(touch);
  } catch {
    return [];
  }
  const ids = [...new Set((labels ?? []).flatMap((label) => parseConcept(label) ?? []))];
  return ids.slice(0, MAX_PROPOSALS).map((concept) => ({ concept, source: "model-proposed", match: touch.file }));
};
