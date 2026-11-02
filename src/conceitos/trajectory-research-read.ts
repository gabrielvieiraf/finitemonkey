import type { EventEntry, JudgeEntry } from "../judge/types.js";
import { isoWeek } from "../signals/blind-band.js";
import { fixOf, type ResearchMark } from "./trajectory-research.js";

const fieldOf = (concepts: readonly string[], entries: readonly JudgeEntry[]): string => {
  for (const concept of concepts) {
    const declared = entries.findLast((entry) => entry.type === "concept" && entry.id === concept);
    if (declared?.type === "concept") return declared.domain;
    if (concept.includes("/")) return concept.split("/")[0] ?? "research";
  }
  return "research";
};

export const researchMarks = (entries: readonly JudgeEntry[]): readonly ResearchMark[] => {
  const latest = new Map<string, EventEntry>();
  for (const entry of entries) if (entry.type === "event") latest.set(entry.id, entry);
  return [...latest.values()].map((event) => {
    const opened = entries.find((entry) => entry.type === "event" && entry.id === event.id)?.at ?? event.at;
    const concepts = Object.keys(event.bands);
    return {
      week: isoWeek(opened) ?? "",
      at: opened,
      event: event.id,
      claim: event.claim,
      cause: event.cause,
      fix: fixOf(event),
      commit: event.fixedCommit ?? null,
      field: fieldOf(concepts, entries),
      concepts,
    };
  });
};
