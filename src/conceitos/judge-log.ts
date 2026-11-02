import type { JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { dropEntries, entryId } from "../judge/store.js";
import type { EvidenceEntry, EvidenceOrigin, JudgeEntry, ProofKind, ProofResult } from "../judge/types.js";
import type { FmPaths } from "../task/paths.js";
import { type Aliases, parseConcept } from "./concepts.js";
import { type ConceptEvent, type ConceptEventKind, type Origin, settled, WEIGHTS } from "./evidence-kinds.js";
import { RECOGNITION_SOURCES, type RecognitionSource } from "./recognize.js";

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
  explanation_right: { proof: "probe", result: "pass" },
  explanation_wrong: { proof: "probe", result: "fail" },
};

const KINDS = Object.entries(PROOFS) as readonly (readonly [ConceptEventKind, Proof])[];

export const isConceitosEvidence = (entry: JudgeEntry): entry is EvidenceEntry =>
  entry.type === "evidence" && (entry.ref === LIVE_REF || entry.ref === MIGRATED_REF);

const PROPOSED: RecognitionSource = "model-proposed";

const judgeOrigin = (origin: Origin): EvidenceOrigin => (origin === "model-proposed" ? "agent" : origin);

export const evidenceRecord = (event: ConceptEvent, index: number, ref: string): JsonObject => ({
  type: "evidence",
  id: entryId("c", ref, event.at, event.concept, event.kind, String(index)),
  at: event.at,
  concepts: [event.concept],
  ...PROOFS[event.kind],
  ref,
  origin: judgeOrigin(event.origin),
  ...(event.task === undefined ? {} : { task: event.task }),
  ...(event.file === undefined ? {} : { file: event.file }),
  ...(event.source === undefined ? {} : { source: event.source }),
  ...(event.match === undefined ? {} : { match: event.match }),
});

const originOf = (entry: EvidenceEntry): Origin | undefined => {
  if (entry.origin === "tool") return undefined;
  return entry.origin === "agent" && entry.source === PROPOSED ? "model-proposed" : entry.origin;
};

const sourceOf = (raw: string | undefined): RecognitionSource | undefined =>
  RECOGNITION_SOURCES.find((item) => item === raw);

const optionalText = (key: "task" | "file" | "match", value: string | undefined): Readonly<Record<string, string>> =>
  value === undefined ? {} : { [key]: value };

export const eventOfEntry = (entry: EvidenceEntry, aliases: Aliases = {}): ConceptEvent | undefined => {
  const concept = parseConcept(entry.concepts[0], aliases);
  const kind = KINDS.find(([, proof]) => proof.proof === entry.proof && proof.result === entry.result)?.[0];
  const origin = originOf(entry);
  if (concept === undefined || kind === undefined || origin === undefined) return undefined;
  const source = sourceOf(entry.source);
  const draft = settled({
    concept,
    kind,
    origin,
    ...optionalText("task", entry.task),
    ...optionalText("file", entry.file),
    ...(source === undefined ? {} : { source }),
    ...optionalText("match", entry.match),
  });
  return { at: entry.at, ...draft, weight: WEIGHTS[draft.kind] };
};

export interface ConceitosLog {
  readonly events: readonly ConceptEvent[];
  readonly migrated: boolean;
}

export const conceitosLog = (entries: readonly JudgeEntry[], aliases: Aliases = {}): ConceitosLog => {
  const own = entries.filter(isConceitosEvidence);
  return {
    events: own.flatMap((entry) => eventOfEntry(entry, aliases) ?? []),
    migrated: own.some((entry) => entry.ref === MIGRATED_REF),
  };
};

export const forgetConceptEvidence = (runtime: Pick<Runtime, "readText" | "writeAtomic">, paths: FmPaths): number =>
  dropEntries(runtime, paths, isConceitosEvidence);
