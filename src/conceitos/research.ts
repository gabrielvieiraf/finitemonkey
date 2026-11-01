import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import type { ConceptId } from "./concepts.js";
import { type ConceptEventDraft, type Origin, recordConceptEvents } from "./evidence.js";
import { recognizeResearch } from "./recognize.js";

export const researchEvents = (slug: string, url: string, origin: Origin): readonly ConceptEventDraft[] =>
  recognizeResearch({ slug, urls: [url] }).map((item) => ({
    concept: item.concept,
    kind: "exposure",
    origin,
    task: `research/${slug}`,
    source: item.source,
    match: item.match,
  }));

export const recordResearchConcepts = (
  runtime: Pick<Runtime, "appendText" | "now" | "readText">,
  paths: FmPaths,
  slug: string,
  url: string,
  origin: Origin,
): readonly ConceptId[] =>
  recordConceptEvents(runtime, paths, researchEvents(slug, url, origin)).map((event) => event.concept);
