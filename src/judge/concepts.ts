import { countRule, effective, evidenceOf, isContested, weightOf } from "./band.js";
import { activeConcepts } from "./claims.js";
import { contentHash } from "./span.js";
import type { Band, ContestEntry, DomainEntry, JudgeEntry } from "./types.js";

export interface SuggestedConcept {
  readonly label: string;
  readonly domain: string;
  readonly synonyms?: readonly string[];
}

export type ConceptSuggester = (text: string) => readonly SuggestedConcept[] | undefined;

export interface DomainView {
  readonly domain: string;
  readonly parent?: string;
  readonly band: Band;
  readonly concepts: number;
  readonly evidence: number;
}

export const conceptIdOf = (domain: string, label: string): string =>
  `${domain}/${label
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")}`;

export const spanAnchor = (
  source: string,
  span: string,
): { kind: "span"; ref: string; span: string; hash: string } => ({
  kind: "span",
  ref: source,
  span,
  hash: contentHash(span),
});

const domainsIn = (entries: readonly JudgeEntry[]): readonly DomainEntry[] =>
  entries.filter((entry): entry is DomainEntry => entry.type === "domain");

const parentOf = (domain: string, entries: readonly JudgeEntry[]): string | undefined =>
  domainsIn(entries).findLast((entry) => entry.id === domain)?.parent ??
  (domain.includes("/") ? domain.slice(0, domain.lastIndexOf("/")) : undefined);

export const withinDomain = (domain: string, candidate: string, entries: readonly JudgeEntry[]): boolean => {
  const seen = new Set<string>();
  for (
    let current: string | undefined = candidate;
    current !== undefined && !seen.has(current);
    current = parentOf(current, entries)
  ) {
    if (current === domain) return true;
    seen.add(current);
  }
  return false;
};

export const domainView = (domain: string, entries: readonly JudgeEntry[]): DomainView => {
  const concepts = activeConcepts(entries).filter((concept) => withinDomain(domain, concept.domain, entries));
  const ids = new Set(concepts.map((concept) => concept.id));
  const evidence = evidenceOf(entries);
  const contests = entries.filter((entry): entry is ContestEntry => entry.type === "contest");
  const counted = evidence.filter(
    (entry) =>
      entry.concepts.some((id) => ids.has(id)) && !isContested(entry, contests, evidence) && weightOf(entry) !== 0,
  );
  const parent = parentOf(domain, entries);
  return {
    domain,
    ...(parent === undefined ? {} : { parent }),
    band: countRule(effective(counted).map(weightOf)),
    concepts: concepts.length,
    evidence: counted.length,
  };
};

export const domainViews = (entries: readonly JudgeEntry[]): readonly DomainView[] =>
  [
    ...new Set([
      ...domainsIn(entries).map((entry) => entry.id),
      ...activeConcepts(entries).map((concept) => concept.domain),
    ]),
  ]
    .sort()
    .map((domain) => domainView(domain, entries));
