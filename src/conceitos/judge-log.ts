import type { JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { conceptIdOf } from "../judge/concepts.js";
import { dropEntries, entryId } from "../judge/store.js";
import type { EvidenceEntry, JudgeEntry, ProofKind, ProofResult } from "../judge/types.js";
import type { FmPaths } from "../task/paths.js";
import { domainOf, parseConcept } from "./concepts.js";
import {
  type ConceptEvent,
  type ConceptEventDraft,
  type ConceptEventKind,
  settled,
  WEIGHTS,
} from "./evidence-kinds.js";

export const LIVE_REF = "conceitos";
export const MIGRATED_REF = "conceitos:migrated";

interface Proof {
  readonly proof: ProofKind;
  readonly result: ProofResult;
}

const PROOFS: Readonly<Record<ConceptEventKind, Proof>> = {
  exposure: { proof: "exposure", result: "pass" },
  prediction_right: { proof: "prediction", result: "pass" },
  prediction_wrong: { proof: "prediction", result: "fail" },
  own_change: { proof: "own-change", result: "pass" },
  own_repair: { proof: "person-repair", result: "pass" },
  failure_after_approval: { proof: "failure-after-acceptance", result: "fail" },
  check_right: { proof: "source-check", result: "pass" },
  check_wrong: { proof: "source-check", result: "fail" },
};

const KINDS = Object.entries(PROOFS) as readonly (readonly [ConceptEventKind, Proof])[];

export const judgeConceptId = (concept: ConceptEventDraft["concept"]): string =>
  conceptIdOf(domainOf(concept), concept);

export const isConceitosEvidence = (entry: JudgeEntry): entry is EvidenceEntry =>
  entry.type === "evidence" && (entry.ref === LIVE_REF || entry.ref === MIGRATED_REF);

export const evidenceRecord = (event: ConceptEvent, index: number, ref: string): JsonObject => ({
  type: "evidence",
  id: entryId("c", ref, event.at, event.concept, event.kind, String(index)),
  at: event.at,
  concepts: [judgeConceptId(event.concept)],
  ...PROOFS[event.kind],
  ref,
  origin: event.origin,
  ...(event.task === undefined ? {} : { task: event.task }),
  ...(event.file === undefined ? {} : { file: event.file }),
});

const conceptOf = (id: string | undefined): ConceptEventDraft["concept"] | undefined => {
  const concept = parseConcept(id?.slice(id.lastIndexOf("/") + 1));
  return concept !== undefined && id === judgeConceptId(concept) ? concept : undefined;
};

export const eventOfEntry = (entry: EvidenceEntry): ConceptEvent | undefined => {
  const concept = conceptOf(entry.concepts[0]);
  const kind = KINDS.find(([, proof]) => proof.proof === entry.proof && proof.result === entry.result)?.[0];
  if (concept === undefined || kind === undefined || entry.origin === "tool") return undefined;
  const draft = settled({
    concept,
    kind,
    origin: entry.origin,
    ...(entry.task === undefined ? {} : { task: entry.task }),
    ...(entry.file === undefined ? {} : { file: entry.file }),
  });
  return { at: entry.at, ...draft, weight: WEIGHTS[draft.kind] };
};

export interface ConceitosLog {
  readonly events: readonly ConceptEvent[];
  readonly migrated: boolean;
}

export const conceitosLog = (entries: readonly JudgeEntry[]): ConceitosLog => {
  const own = entries.filter(isConceitosEvidence);
  return {
    events: own.flatMap((entry) => eventOfEntry(entry) ?? []),
    migrated: own.some((entry) => entry.ref === MIGRATED_REF),
  };
};

export const forgetConceptEvidence = (runtime: Pick<Runtime, "readText" | "writeAtomic">, paths: FmPaths): number =>
  dropEntries(runtime, paths, isConceitosEvidence);
