import { isoWeek } from "../signals/blind-band.js";
import { type ConceptId, parseConcept } from "./concepts.js";
import { type ConceptEvent, stateOf } from "./evidence.js";
import { fieldOfUrl } from "./recognize.js";
import type { AloneSide, OutcomeMark, Split, WeekSplits } from "./trajectory-split-types.js";

export {
  type AloneSide,
  type OutcomeMark,
  type Split,
  SPLIT_GROUPS,
  SPLIT_SIDES,
  type SplitGroup,
  type WeekSplits,
} from "./trajectory-split-types.js";

const INDEPENDENT: ReadonlySet<string> = new Set(["own_change", "own_repair"]);
const DETECTS: ReadonlySet<string> = new Set(["prediction_right", "check_right"]);

export const areaOf = (file: string): string => {
  const parts = file
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".");
  const folders = parts.slice(0, Math.max(0, parts.length - 1)).slice(0, 2);
  return folders.length === 0 ? "." : folders.join("/");
};

export const researchFieldOf = (concept: ConceptId): string | undefined => {
  const [top, field] = (parseConcept(concept) ?? "").split("/");
  return top === "research" && field !== undefined && field !== "" ? `research/${field}` : undefined;
};

export const eventAreaOf = (event: Pick<ConceptEvent, "concept" | "file" | "match">): string | undefined => {
  if (event.file !== undefined) return areaOf(event.file);
  const cited = event.match === undefined ? undefined : fieldOfUrl(event.match);
  return cited === undefined ? researchFieldOf(event.concept) : `research/${cited}`;
};

const proofOf = (event: ConceptEvent): boolean => event.origin === "person" && event.weight > 0;

export const aloneSideOf = (events: readonly ConceptEvent[], index: number): AloneSide | undefined => {
  const event = events[index];
  const area = event === undefined ? undefined : eventAreaOf(event);
  if (event === undefined || area === undefined || !INDEPENDENT.has(event.kind) || !proofOf(event)) return undefined;
  const concept = parseConcept(event.concept) ?? event.concept;
  const before = events.slice(0, index).filter((item) => (parseConcept(item.concept) ?? item.concept) === concept);
  if (stateOf(before) !== "demonstrated") return undefined;
  const known = new Set(before.flatMap((item) => (proofOf(item) ? (eventAreaOf(item) ?? []) : [])));
  return known.has(area) ? "known" : "transfer";
};

export interface Classified {
  readonly event: ConceptEvent;
  readonly side: "known" | "transfer" | "explains" | "detects";
}

export const classify = (events: readonly ConceptEvent[]): readonly Classified[] =>
  events.flatMap((event, index): Classified[] => {
    const alone = aloneSideOf(events, index);
    if (alone !== undefined) return [{ event, side: alone }];
    if (event.origin !== "person") return [];
    if (event.kind === "explanation_right") return [{ event, side: "explains" }];
    return DETECTS.has(event.kind) ? [{ event, side: "detects" }] : [];
  });

const conceptsWith = (items: readonly Classified[], side: Classified["side"]): ReadonlySet<ConceptId> =>
  new Set(items.filter((item) => item.side === side).map((item) => item.event.concept));

const pair = (items: readonly Classified[], first: Classified["side"], second: Classified["side"]): Split => {
  const winner = conceptsWith(items, first);
  const rest = [...conceptsWith(items, second)].filter((concept) => !winner.has(concept));
  const evidence = items.filter((item) => item.side === first || item.side === second).length;
  return { lower: winner.size, upper: rest.length, evidence };
};

export const splitsOf = (
  classified: readonly Classified[],
  outcomes: readonly OutcomeMark[],
  domain: string,
  key: string,
): WeekSplits => {
  const upTo = classified.filter((item) => (isoWeek(item.event.at) ?? "") <= key);
  const mine = outcomes.filter((item) => item.domain === domain && (isoWeek(item.at) ?? "") <= key);
  const recognizable = mine.filter((item) => item.outcome === "recognizable").length;
  const alone = pair(upTo, "transfer", "known");
  return {
    alone: { lower: alone.upper, upper: alone.lower, evidence: alone.evidence },
    proximal: pair(upTo, "explains", "detects"),
    horizon: { lower: recognizable, upper: mine.length - recognizable, evidence: mine.length },
  };
};
