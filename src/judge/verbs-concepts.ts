import { activeConcepts, conceptsIn, conceptsMentioned } from "./claims.js";
import { conceptIdOf, domainViews, spanAnchor } from "./concepts.js";
import { appendNow, type JudgeDeps } from "./deps.js";
import type { JudgeRequest } from "./request.js";
import { conceptViews, type JudgeResponse, response } from "./response.js";
import { entryId, readEntries } from "./store.js";
import type { JudgeEntry } from "./types.js";

type Request<V extends JudgeRequest["verb"]> = Extract<JudgeRequest, { verb: V }>;

const suggest = (deps: JudgeDeps, text: string, entries: readonly JudgeEntry[]): void => {
  const known = new Set(conceptsIn(entries).map((concept) => concept.id));
  for (const item of deps.suggester?.(text) ?? []) {
    const id = conceptIdOf(item.domain, item.label);
    if (known.has(id)) continue;
    known.add(id);
    appendNow(deps, {
      type: "concept",
      id,
      domain: item.domain,
      label: item.label,
      synonyms: item.synonyms ?? [],
      anchors: [],
      origin: "model",
    });
  }
};

const conceptsOf = (deps: JudgeDeps, request: Request<"observe">): readonly string[] => {
  if (request.text === undefined) return request.concepts;
  const entries = readEntries(deps.runtime, deps.paths);
  suggest(deps, request.text, entries);
  return [
    ...new Set([...request.concepts, ...conceptsMentioned(request.text, activeConcepts(entries)).map((c) => c.id)]),
  ];
};

export const observe = (deps: JudgeDeps, request: Request<"observe">): JudgeResponse => {
  const concepts = conceptsOf(deps, request);
  if (concepts.length === 0) return response("observe", { concepts: [] });
  const at = deps.runtime.now();
  const id = entryId("e", concepts.join(","), request.proof, request.ref ?? "", at);
  const written = appendNow(deps, {
    type: "evidence",
    id,
    origin: "agent",
    concepts,
    proof: request.proof,
    result: request.result,
    ref: request.ref,
    claim: request.claim,
  });
  if (!written.ok) return response("observe", { reason: written.reason });
  return response("observe", { entry: id, concepts: conceptViews(readEntries(deps.runtime, deps.paths), concepts) });
};

export const addConcept = (deps: JudgeDeps, request: Request<"concept">): JudgeResponse => {
  const id = conceptIdOf(request.domain, request.label);
  const written = appendNow(deps, {
    type: "concept",
    id,
    domain: request.domain,
    label: request.label,
    synonyms: request.synonyms,
    anchors: [spanAnchor(request.source, request.span)],
    origin: "span",
  });
  if (!written.ok) return response("concept", { reason: written.reason });
  return response("concept", { entry: id, concepts: conceptViews(readEntries(deps.runtime, deps.paths), [id]) });
};

export const addDomain = (deps: JudgeDeps, request: Request<"domain">): JudgeResponse => {
  const written = appendNow(deps, { type: "domain", id: request.domain, parent: request.parent });
  if (!written.ok) return response("domain", { reason: written.reason });
  return response("domain", { entry: request.domain, domains: domainViews(readEntries(deps.runtime, deps.paths)) });
};
