import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import type { ConceptId } from "./concepts.js";
import { type ConceptEventDraft, type Origin, recordConceptEvents } from "./evidence.js";
import { recognizeResearch } from "./recognize.js";

export interface ResearchWork {
  readonly slug: string;
  readonly url: string;
  readonly question?: string;
  readonly decision?: string;
}

export const researchEvents = (work: ResearchWork, origin: Origin): readonly ConceptEventDraft[] =>
  recognizeResearch({
    slug: work.slug,
    urls: [work.url],
    ...(work.question === undefined ? {} : { question: work.question }),
    ...(work.decision === undefined ? {} : { decision: work.decision }),
  }).map((item) => ({
    concept: item.concept,
    kind: "exposure",
    origin,
    task: `research/${work.slug}`,
    source: item.source,
    match: item.match,
  }));

export const recordResearchConcepts = (
  runtime: Pick<Runtime, "appendText" | "mkdir" | "now" | "readText">,
  paths: FmPaths,
  work: ResearchWork,
  origin: Origin,
): readonly ConceptId[] =>
  recordConceptEvents(runtime, paths, researchEvents(work, origin)).map((event) => event.concept);
