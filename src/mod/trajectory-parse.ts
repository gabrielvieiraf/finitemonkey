import type { ConceptId } from "../conceitos/concepts.js";
import type { DomainTrajectory, EvidenceRef, Mark, Week } from "../conceitos/trajectory.js";
import { RESEARCH_FIXES, type ResearchMark } from "../conceitos/trajectory-research.js";
import type { Split, WeekSplits } from "../conceitos/trajectory-split-types.js";

type Domain = DomainTrajectory["domain"];
const DOMAIN_NAMES: readonly Domain[] = ["product", "interface", "backend", "infrastructure", "security"];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const records = (value: unknown): readonly Readonly<Record<string, unknown>>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const str = (record: Readonly<Record<string, unknown>>, key: string): string =>
  typeof record[key] === "string" ? record[key] : "";

const orNull = (record: Readonly<Record<string, unknown>>, key: string): number | null =>
  typeof record[key] === "number" ? record[key] : null;

const num = (record: Readonly<Record<string, unknown>>, key: string): number =>
  typeof record[key] === "number" ? record[key] : 0;

const concept = (value: unknown): ConceptId => (typeof value === "string" && value !== "" ? value : "unknown");

const splitOf = (value: unknown): Split | undefined =>
  isRecord(value)
    ? { lower: num(value, "lower"), upper: num(value, "upper"), evidence: num(value, "evidence") }
    : undefined;

const splitsIn = (item: Readonly<Record<string, unknown>>): { readonly splits?: WeekSplits } => {
  const raw = item["splits"];
  if (!isRecord(raw)) return {};
  const [alone, proximal, horizon] = [splitOf(raw["alone"]), splitOf(raw["proximal"]), splitOf(raw["horizon"])];
  return alone === undefined || proximal === undefined || horizon === undefined
    ? {}
    : { splits: { alone, proximal, horizon } };
};

const weekOf = (item: Readonly<Record<string, unknown>>): Week => ({
  week: str(item, "week"),
  independent: orNull(item, "independent"),
  discernment: orNull(item, "discernment"),
  assisted: orNull(item, "assisted"),
  blindCovered: num(item, "blindCovered"),
  blindBare: num(item, "blindBare"),
  unstable: orNull(item, "unstable"),
  work: orNull(item, "work"),
  evidence: num(item, "evidence"),
  ...splitsIn(item),
});

const refOf = (item: Readonly<Record<string, unknown>>): EvidenceRef => ({
  kind: str(item, "kind"),
  at: str(item, "at"),
  concept: concept(item["concept"]),
  task: typeof item["task"] === "string" ? item["task"] : null,
  file: typeof item["file"] === "string" ? item["file"] : null,
});

const markOf = (item: Readonly<Record<string, unknown>>): Mark => ({
  kind: item["kind"] === "held" ? "held" : "ricochet",
  week: str(item, "week"),
  concept: concept(item["concept"]),
  at: str(item, "at"),
  from: typeof item["from"] === "string" ? item["from"] : null,
  evidence: records(item["evidence"]).map(refOf),
});

const researchOf = (item: Readonly<Record<string, unknown>>): ResearchMark => ({
  week: str(item, "week"),
  at: str(item, "at"),
  event: str(item, "event"),
  claim: str(item, "claim"),
  cause: str(item, "cause"),
  fix: RESEARCH_FIXES.find((fix) => fix === item["fix"]) ?? "open",
  commit: typeof item["commit"] === "string" ? item["commit"] : null,
  field: str(item, "field"),
  concepts: Array.isArray(item["concepts"])
    ? item["concepts"].filter((value): value is string => typeof value === "string")
    : [],
});

const researchIn = (item: Readonly<Record<string, unknown>>): { readonly research?: readonly ResearchMark[] } => {
  const marks = records(item["research"]).map(researchOf);
  return marks.length === 0 ? {} : { research: marks };
};

export const parseTrajectories = (text: string): readonly DomainTrajectory[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const data = isRecord(parsed) && isRecord(parsed["data"]) ? parsed["data"] : parsed;
  if (!isRecord(data) || data["schema"] !== "finitemonkey/trajectory@1") return [];
  return records(data["domains"]).flatMap((item): DomainTrajectory[] => {
    const domain = DOMAIN_NAMES.find((name) => name === item["domain"]);
    if (domain === undefined) return [];
    return [
      {
        domain,
        status: item["status"] === "ok" ? "ok" : "no_data",
        evidence: num(item, "evidence"),
        weeks: records(item["weeks"]).map(weekOf),
        marks: records(item["marks"]).map(markOf),
        position: typeof item["position"] === "string" ? item["position"] : null,
        ...researchIn(item),
      },
    ];
  });
};
