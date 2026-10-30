import type { Fetched, SourceFetcher } from "./fetch.js";
import { perturb } from "./probe.js";
import { contentHash, normalizeSpan, spanIn } from "./span.js";
import type { JudgeAnchor } from "./types.js";
import { notVerified, type Verdict, type Verifier } from "./verify.js";

export const CITE_FEATURE = "cite-span";

export interface Citation {
  readonly id: string;
  readonly label: string;
}

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const BARE = /\b(10\.\d{4,9}\/[^\s)\]"”,;]+|https?:\/\/[^\s)\]"”,;]+)/g;
const QUOTE = /[“"]([^”"]{3,})[”"]/g;
const YEAR = /\b(?:1[89]|20)\d{2}\b/g;
const NAME = /\b\p{Lu}[\p{Ll}'-]{2,}\b/gu;
const STOP = new Set([
  "The",
  "And",
  "For",
  "With",
  "From",
  "Report",
  "Journal",
  "Review",
  "Proceedings",
  "Press",
  "News",
]);

const trimmed = (id: string): string => id.replace(/[.]+$/, "");

const idOf = (target: string): string => {
  const doi = /^https?:\/\/(?:dx\.)?doi\.org\/(10\.\S+)$/i.exec(target);
  return trimmed(doi?.[1] ?? target);
};

const enclosing = (text: string, index: number, id: string): string => {
  const open = text.lastIndexOf("(", index);
  const close = text.indexOf(")", index);
  if (open < 0 || close < 0 || text.slice(open, index).includes(")")) return "";
  return text.slice(open + 1, close).replace(id, "");
};

export const citationsIn = (text: string): readonly Citation[] => {
  const links = [...text.matchAll(LINK)].map((match) => ({ id: idOf(match[2] ?? ""), label: match[1] ?? "" }));
  const outside = text.replace(LINK, " ");
  const bare = [...outside.matchAll(BARE)].map((match) => {
    const id = idOf(match[1] ?? "");
    return { id, label: enclosing(outside, match.index, match[1] ?? "") };
  });
  const unique = new Map<string, Citation>();
  for (const item of [...links, ...bare]) if (item.id !== "" && !unique.has(item.id)) unique.set(item.id, item);
  return [...unique.values()];
};

export const quotesIn = (text: string): readonly string[] =>
  [...text.replace(LINK, (_all, label: string) => label).matchAll(QUOTE)].map((match) => match[1] ?? "");

export const labelTerms = (label: string): readonly string[] => [
  ...(label.match(YEAR) ?? []),
  ...[...label.matchAll(NAME)].map((match) => match[0]).filter((word) => !STOP.has(word)),
];

interface Resolved {
  readonly citation: Citation;
  readonly fetched: Fetched;
}

const caughtMutant = (quote: string, content: string): boolean => {
  const mutated = normalizeSpan(content).replace(normalizeSpan(quote), normalizeSpan(perturb(quote)));
  return !spanIn(quote, mutated);
};

const quoteAnchors = (
  quotes: readonly string[],
  sources: readonly { readonly id: string; readonly content: string }[],
): readonly JudgeAnchor[] | undefined => {
  const anchors: JudgeAnchor[] = [];
  for (const quote of quotes) {
    const source = sources.find((item) => spanIn(quote, item.content));
    if (source === undefined) return undefined;
    anchors.push({ kind: "span", ref: source.id, span: quote, hash: contentHash(source.content) });
  }
  return anchors;
};

const judged = (resolved: readonly Resolved[], quotes: readonly string[]): Verdict => {
  const sources = resolved.flatMap(({ citation, fetched }) =>
    fetched.status === "ok" ? [{ id: citation.id, content: fetched.content }] : [],
  );
  const labelsHold = sources.every((source) => {
    const label = resolved.find((item) => item.citation.id === source.id)?.citation.label ?? "";
    return labelTerms(label).every((term) => normalizeSpan(source.content).includes(normalizeSpan(term)));
  });
  const anchors = quoteAnchors(quotes, sources);
  if (!labelsHold || anchors === undefined) return notVerified("mismatch");
  if (quotes.length === 0) return { verified: false, outcome: "non-literal" };
  const weak = quotes.some(
    (quote) => !sources.some((source) => spanIn(quote, source.content) && caughtMutant(quote, source.content)),
  );
  return { verified: true, outcome: weak ? "verified-weak" : "verified", ref: anchors[0]?.hash ?? "", anchors };
};

export const checkCitations = (text: string, fetcher: SourceFetcher): Verdict => {
  const citations = citationsIn(text);
  if (citations.length === 0) return notVerified("no-citation");
  const resolved = citations.map((citation) => ({ citation, fetched: fetcher(citation.id) }));
  if (resolved.some((item) => item.fetched.status === "not-found")) return notVerified("unresolved");
  if (resolved.some((item) => item.fetched.status === "unreachable")) return notVerified("not-verified");
  return judged(resolved, quotesIn(text));
};

export const citeVerifier: Verifier = (claim, context) =>
  context.fetcher === undefined ? notVerified("no-fetcher") : checkCitations(claim.text, context.fetcher);
