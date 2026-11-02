import { domainOf, parseConcept } from "../src/conceitos/concepts.js";
import { type ConceptEvent, EVENT_KINDS, WEIGHTS } from "../src/conceitos/evidence.js";
import { SPLIT_STATUS } from "../src/conceitos/trajectory-bands.js";
import { classify, SPLIT_GROUPS, SPLIT_SIDES, type SplitGroup } from "../src/conceitos/trajectory-splits.js";
import type { JsonObject } from "../src/core/parsed.js";
import { outcomeMarks } from "../src/judge/horizon-outcome.js";
import type { KnowledgeBand } from "./bench-family.js";
import { lines, str, text } from "./bench-state.js";

export interface SplitTruth {
  readonly knowledge: Readonly<Record<string, KnowledgeBand>>;
  readonly fmDomain: string;
}

type Side = (typeof SPLIT_SIDES)[SplitGroup][number];

const EXPECTED: Readonly<Record<SplitGroup, Readonly<Record<KnowledgeBand, Side | "none">>>> = {
  alone: { within: "transfer", edge: "known", beyond: "none" },
  proximal: { within: "explains", edge: "detects", beyond: "none" },
  horizon: { within: "recognizable", edge: "recognizable", beyond: "outOfReach" },
};

const eventOf = (line: JsonObject): ConceptEvent[] => {
  const concept = parseConcept(str(line["concept"]));
  const kind = EVENT_KINDS.find((item) => item === line["kind"]);
  const origin = line["origin"] === "agent" ? "agent" : line["origin"] === "person" ? "person" : undefined;
  const at = str(line["at"]);
  if (concept === undefined || kind === undefined || origin === undefined || at === undefined) return [];
  const file = str(line["file"]);
  return [{ at, concept, kind, origin, weight: WEIGHTS[kind], ...(file === undefined ? {} : { file }) }];
};

const countsOf = (dir: string, domain: string): Readonly<Record<Side, number>> => {
  const events = lines(dir, "conceitos-events.jsonl")
    .flatMap(eventOf)
    .filter((event) => domainOf(event.concept) === domain);
  const sides = classify(events).map((item) => item.side);
  const outcomes = outcomeMarks(text(dir, "log.jsonl") ?? "").filter((item) => item.domain === domain);
  const count = (side: string): number => sides.filter((item) => item === side).length;
  return {
    known: count("known"),
    transfer: count("transfer"),
    explains: count("explains"),
    detects: count("detects"),
    recognizable: outcomes.filter((item) => item.outcome === "recognizable").length,
    outOfReach: outcomes.filter((item) => item.outcome === "out_of_reach").length,
  };
};

const verdictOf = (expected: Side | "none" | null, lower: number, upper: number, sides: readonly [Side, Side]) => {
  if (expected === null) return "not-scored";
  if (expected === "none") return lower + upper === 0 ? "right" : "wrong";
  if (lower + upper === 0) return "no-evidence";
  if (lower === upper) return "tie";
  return (lower > upper ? sides[0] : sides[1]) === expected ? "right" : "wrong";
};

export const splitsAgreement = (dir: string, truth: SplitTruth): JsonObject => {
  const counts = countsOf(dir, truth.fmDomain);
  const band = truth.knowledge[truth.fmDomain];
  const rows = SPLIT_GROUPS.map((group) => {
    const [lower, upper] = SPLIT_SIDES[group];
    const expected = band === undefined ? null : EXPECTED[group][band];
    const verdict = verdictOf(expected, counts[lower], counts[upper], SPLIT_SIDES[group]);
    return [group, { lower: counts[lower], upper: counts[upper], expected, verdict }] as const;
  });
  return { status: SPLIT_STATUS, ...Object.fromEntries(rows) };
};
