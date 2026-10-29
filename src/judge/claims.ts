import { type ConceptBand, conceptBand, evidenceOf, worstBand } from "./band.js";
import { entryId } from "./store.js";
import type { Band, ClaimEntry, ConceptEntry, JudgeEntry, ResultEntry, SupportEntry, SupportState } from "./types.js";

export const normalizeClaim = (text: string): string => text.replace(/\s+/g, " ").trim();

export const claimIdOf = (text: string): string => entryId("j", normalizeClaim(text).toLowerCase());

export const claimsIn = (entries: readonly JudgeEntry[]): readonly ClaimEntry[] =>
  entries.filter((entry): entry is ClaimEntry => entry.type === "claim");

export const conceptsIn = (entries: readonly JudgeEntry[]): readonly ConceptEntry[] =>
  entries.filter((entry): entry is ConceptEntry => entry.type === "concept");

export type ConceptStatus = "active" | "suggested";

export const usedInEvidence = (concept: string, entries: readonly JudgeEntry[]): boolean =>
  evidenceOf(entries).some((entry) => entry.proof !== "exposure" && entry.concepts.includes(concept));

export const conceptStatus = (concept: ConceptEntry, entries: readonly JudgeEntry[]): ConceptStatus =>
  concept.origin === "model" && !usedInEvidence(concept.id, entries) ? "suggested" : "active";

export const activeConcepts = (entries: readonly JudgeEntry[]): readonly ConceptEntry[] =>
  conceptsIn(entries).filter((concept) => conceptStatus(concept, entries) === "active");

export const resultsIn = (entries: readonly JudgeEntry[]): readonly ResultEntry[] =>
  entries.filter((entry): entry is ResultEntry => entry.type === "result");

export const lastSupport = (claim: string, entries: readonly JudgeEntry[]): SupportEntry | undefined =>
  entries.findLast((entry): entry is SupportEntry => entry.type === "support" && entry.claim === claim);

export const supportStateOf = (claim: string, entries: readonly JudgeEntry[]): SupportState =>
  lastSupport(claim, entries)?.state ?? "model-only";

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const mentionsTerm = (text: string, term: string): boolean =>
  term.trim() !== "" && new RegExp(`(^|[^\\p{L}\\p{N}])${escape(term.trim())}($|[^\\p{L}\\p{N}])`, "iu").test(text);

export const conceptsMentioned = (text: string, concepts: readonly ConceptEntry[]): readonly ConceptEntry[] =>
  concepts.filter((concept) => [concept.label, ...concept.synonyms].some((term) => mentionsTerm(text, term)));

export const touchedConcepts = (claim: ClaimEntry, entries: readonly JudgeEntry[]): readonly string[] => {
  const mentioned = conceptsMentioned(claim.text, activeConcepts(entries)).map((concept) => concept.id);
  return [...new Set([...claim.concepts, ...mentioned])];
};

export interface ClaimBand {
  readonly band: Band;
  readonly concepts: readonly ConceptBand[];
}

export const claimBand = (claim: ClaimEntry, entries: readonly JudgeEntry[]): ClaimBand => {
  const concepts = touchedConcepts(claim, entries).map((id) => conceptBand(id, entries));
  return { band: worstBand(concepts.map((item) => item.band)), concepts };
};

export const bandSnapshot = (claim: ClaimEntry, entries: readonly JudgeEntry[]): Readonly<Record<string, Band>> =>
  Object.fromEntries(claimBand(claim, entries).concepts.map((item) => [item.concept, item.band]));
