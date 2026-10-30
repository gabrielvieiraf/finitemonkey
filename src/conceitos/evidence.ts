import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { AddedLine } from "../gate/git.js";
import type { Domain } from "../perfil/types.js";
import type { FmPaths } from "../task/paths.js";
import { CONCEPT_IDS, type ConceptId, conceptsIn, domainOf, parseConcept } from "./concepts.js";

export const CONCEPT_EVENTS_FILE = "conceitos-events.jsonl";
export const CONCEPT_EVIDENCE_SCHEMA = "finitemonkey/concept-evidence@1";
export const DEMONSTRATED_AFTER = 3;

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

export const STATES = ["demonstrated", "proximal", "beyond", "unknown"] as const;
export type ConceptState = (typeof STATES)[number];

export interface ConceptSummary {
  readonly concept: ConceptId;
  readonly domain: Domain;
  readonly state: ConceptState;
  readonly positive: number;
  readonly negative: number;
  readonly exposures: number;
  readonly last: string | null;
  readonly evidence: readonly ConceptEvent[];
}

export const eventsPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, CONCEPT_EVENTS_FILE));

export const settled = (draft: ConceptEventDraft): ConceptEventDraft =>
  draft.origin === "agent" && PERSON_ONLY.has(draft.kind) ? { ...draft, kind: "exposure" } : draft;

export const recordConceptEvents = (
  runtime: Pick<Runtime, "appendText" | "now">,
  paths: FmPaths,
  drafts: readonly ConceptEventDraft[],
): readonly ConceptEvent[] => {
  if (drafts.length === 0) return [];
  const at = runtime.now();
  const events = drafts.map(settled).map((draft) => ({ at, ...draft, weight: WEIGHTS[draft.kind] }));
  runtime.appendText(eventsPath(paths), events.map((event) => `${JSON.stringify(event)}\n`).join(""));
  return events;
};

const kindOf = (raw: unknown): ConceptEventKind | undefined => EVENT_KINDS.find((kind) => kind === raw);

const eventOf = (line: string): ConceptEvent | undefined => {
  const parsed = parseJsonObject(line);
  if (!parsed.ok || !isRecord(parsed.value)) return undefined;
  const raw = parsed.value;
  const concept = parseConcept(typeof raw["concept"] === "string" ? raw["concept"] : undefined);
  const kind = kindOf(raw["kind"]);
  const origin = raw["origin"] === "agent" ? "agent" : raw["origin"] === "person" ? "person" : undefined;
  if (concept === undefined || kind === undefined || origin === undefined || typeof raw["at"] !== "string")
    return undefined;
  const draft = settled({
    concept,
    kind,
    origin,
    ...(typeof raw["task"] === "string" ? { task: raw["task"] } : {}),
    ...(typeof raw["file"] === "string" ? { file: raw["file"] } : {}),
  });
  return { at: raw["at"], ...draft, weight: WEIGHTS[draft.kind] };
};

export const readConceptEvents = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly ConceptEvent[] => {
  const text = runtime.readText(eventsPath(paths));
  if (!text.ok) return [];
  return text.value.split("\n").flatMap((line) => {
    const event = line.trim() === "" ? undefined : eventOf(line);
    return event === undefined ? [] : [event];
  });
};

export const stateOf = (events: readonly ConceptEvent[]): ConceptState => {
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

export const conceptSummaries = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly ConceptSummary[] => {
  const events = readConceptEvents(runtime, paths);
  return CONCEPT_IDS.map((concept) => summarize(concept, events));
};

const PATH_DETECTORS: readonly { readonly concept: ConceptId; readonly pattern: RegExp }[] = [
  { concept: "migration", pattern: /(^|\/)(?:db\/)?migrations?\// },
  { concept: "webhook", pattern: /webhooks?/i },
  { concept: "api", pattern: /(^|\/)(?:api|routes)\// },
];

export const conceptsOfFile = (file: string, lines: readonly string[]): readonly ConceptId[] => {
  const found = new Set<ConceptId>([
    ...PATH_DETECTORS.filter((detector) => detector.pattern.test(file)).map((detector) => detector.concept),
    ...conceptsIn(lines.join("\n")),
  ]);
  return CONCEPT_IDS.filter((id) => found.has(id));
};

export const groupByFile = (added: readonly AddedLine[]): ReadonlyMap<string, readonly string[]> => {
  const files = new Map<string, string[]>();
  for (const line of added) files.set(line.path, [...(files.get(line.path) ?? []), line.text]);
  return files;
};

export interface Provenance {
  readonly agentFiles: ReadonlySet<string>;
  readonly repaired: boolean;
  readonly task: string;
}

export const changeEvents = (added: readonly AddedLine[], provenance: Provenance): readonly ConceptEventDraft[] =>
  [...groupByFile(added)].flatMap(([file, lines]) => {
    const agent = provenance.agentFiles.has(file);
    return conceptsOfFile(file, lines).map((concept): ConceptEventDraft => ({
      concept,
      kind: agent ? "exposure" : provenance.repaired ? "own_repair" : "own_change",
      origin: agent ? "agent" : "person",
      task: provenance.task,
      file,
    }));
  });
