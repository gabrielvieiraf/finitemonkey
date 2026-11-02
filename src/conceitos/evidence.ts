import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { appendEntry, readEntries } from "../judge/store.js";
import { DEMONSTRATED_AFTER } from "../judge/types.js";
import type { FmPaths } from "../task/paths.js";
import { bookConcepts, readBook } from "./book.js";
import { type Aliases, type ConceptId, domainOf, parseConcept } from "./concepts.js";
import {
  type ConceptEvent,
  type ConceptEventDraft,
  type ConceptEventKind,
  EVENT_KINDS,
  ORIGINS,
  settled,
  WEIGHTS,
} from "./evidence-kinds.js";
import { conceitosLog, evidenceRecord, LIVE_REF } from "./judge-log.js";
import { RECOGNITION_SOURCES, type RecognitionSource } from "./recognize.js";

export {
  type ConceptEvent,
  type ConceptEventDraft,
  type ConceptEventKind,
  EVENT_KINDS,
  type Origin,
  ORIGINS,
  settled,
  WEIGHTS,
} from "./evidence-kinds.js";

export const CONCEPT_EVENTS_FILE = "conceitos-events.jsonl";
export const CONCEPT_EVIDENCE_SCHEMA = "finitemonkey/concept-evidence@1";

export const STATES = ["demonstrated", "proximal", "beyond", "unknown"] as const;
export type ConceptState = (typeof STATES)[number];

export interface ConceptSummary {
  readonly concept: ConceptId;
  readonly domain: string;
  readonly state: ConceptState;
  readonly positive: number;
  readonly negative: number;
  readonly exposures: number;
  readonly last: string | null;
  readonly evidence: readonly ConceptEvent[];
}

export const eventsPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, CONCEPT_EVENTS_FILE));

const aliasesAt = (runtime: Pick<Runtime, "readText">, paths: FmPaths): Aliases =>
  readBook(runtime, paths).aliases ?? {};

const resolved = (draft: ConceptEventDraft, aliases: Aliases): readonly ConceptEventDraft[] => {
  const concept = parseConcept(draft.concept, aliases);
  return concept === undefined ? [] : [settled({ ...draft, concept })];
};

export const recordConceptEvents = (
  runtime: Pick<Runtime, "appendText" | "mkdir" | "now" | "readText">,
  paths: FmPaths,
  drafts: readonly ConceptEventDraft[],
): readonly ConceptEvent[] => {
  if (drafts.length === 0) return [];
  const at = runtime.now();
  const aliases = aliasesAt(runtime, paths);
  const events = drafts
    .flatMap((draft) => resolved(draft, aliases))
    .map((draft) => ({ at, ...draft, weight: WEIGHTS[draft.kind] }));
  events.forEach((event, index) => appendEntry(runtime, paths, evidenceRecord(event, index, LIVE_REF)));
  return events;
};

const kindOf = (raw: unknown): ConceptEventKind | undefined => EVENT_KINDS.find((kind) => kind === raw);

const sourceOf = (raw: unknown): RecognitionSource | undefined => RECOGNITION_SOURCES.find((item) => item === raw);

const optionalText = (raw: Readonly<Record<string, unknown>>, key: string): Readonly<Record<string, string>> =>
  typeof raw[key] === "string" ? { [key]: raw[key] } : {};

const eventOf = (line: string, aliases: Aliases): ConceptEvent | undefined => {
  const parsed = parseJsonObject(line);
  if (!parsed.ok || !isRecord(parsed.value)) return undefined;
  const raw = parsed.value;
  const concept = parseConcept(typeof raw["concept"] === "string" ? raw["concept"] : undefined, aliases);
  const kind = kindOf(raw["kind"]);
  const origin = ORIGINS.find((item) => item === raw["origin"]);
  const source = sourceOf(raw["source"]);
  if (concept === undefined || kind === undefined || origin === undefined || typeof raw["at"] !== "string")
    return undefined;
  const draft = settled({
    concept,
    kind,
    origin,
    ...optionalText(raw, "task"),
    ...optionalText(raw, "file"),
    ...(source === undefined ? {} : { source }),
    ...optionalText(raw, "match"),
  });
  return { at: raw["at"], ...draft, weight: WEIGHTS[draft.kind] };
};

const legacyAt = (runtime: Pick<Runtime, "readText">, paths: FmPaths, aliases: Aliases): readonly ConceptEvent[] => {
  const text = runtime.readText(eventsPath(paths));
  if (!text.ok) return [];
  return text.value.split("\n").flatMap((line) => {
    const event = line.trim() === "" ? undefined : eventOf(line, aliases);
    return event === undefined ? [] : [event];
  });
};

export const readLegacyEvents = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly ConceptEvent[] =>
  legacyAt(runtime, paths, aliasesAt(runtime, paths));

export const readConceptEvents = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly ConceptEvent[] => {
  const aliases = aliasesAt(runtime, paths);
  const log = conceitosLog(readEntries(runtime, paths), aliases);
  return log.migrated ? log.events : [...legacyAt(runtime, paths, aliases), ...log.events];
};

export const stateOf = (all: readonly ConceptEvent[]): ConceptState => {
  const events = all.filter((event) => event.origin !== "model-proposed");
  if (events.length === 0) return "unknown";
  const lastNegative = events.findLastIndex((event) => event.weight < 0);
  const lastPositive = events.findLastIndex((event) => event.weight > 0);
  if (lastPositive < 0) return "beyond";
  const fresh = events.slice(lastNegative + 1).filter((event) => event.weight > 0).length;
  if (fresh >= DEMONSTRATED_AFTER) return "demonstrated";
  if (lastNegative > lastPositive) {
    const before = events.slice(0, lastNegative).filter((event) => event.weight > 0).length;
    return before >= DEMONSTRATED_AFTER ? "proximal" : "beyond";
  }
  return "proximal";
};

export const summarize = (concept: ConceptId, all: readonly ConceptEvent[]): ConceptSummary => {
  const events = all.filter((event) => event.concept === concept);
  return {
    concept,
    domain: domainOf(concept),
    state: stateOf(events),
    positive: events.filter((event) => event.weight > 0).length,
    negative: events.filter((event) => event.weight < 0).length,
    exposures: events.filter((event) => event.kind === "exposure").length,
    last: events.at(-1)?.at ?? null,
    evidence: events.filter((event) => event.weight !== 0).slice(-10),
  };
};

export const knownConcepts = (events: readonly ConceptEvent[], extra: Iterable<ConceptId> = []): readonly ConceptId[] =>
  [...new Set([...events.map((event) => event.concept), ...extra])].sort();

export const conceptSummaries = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly ConceptSummary[] => {
  const events = readConceptEvents(runtime, paths);
  const book = readBook(runtime, paths);
  return knownConcepts(events, bookConcepts(book)).map((concept) => summarize(concept, events));
};
