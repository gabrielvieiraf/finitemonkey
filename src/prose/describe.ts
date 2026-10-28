import type { MessageKey } from "../i18n/catalogs.js";
import type { Translate } from "../i18n/translate.js";
import type { ProseRuleId, ProseSpan } from "./types.js";

export const RULE_FIX_KEYS = {
  "opener-routine": "prose.rule.opener-routine",
  reassurance: "prose.rule.reassurance",
  "slogan-closer": "prose.rule.slogan-closer",
  "rhythmic-triplet": "prose.rule.rhythmic-triplet",
  "imperative-fragment": "prose.rule.imperative-fragment",
  antithesis: "prose.rule.antithesis",
  "abstract-noun": "prose.rule.abstract-noun",
  "crutch-word": "prose.rule.crutch-word",
  "colon-heading": "prose.rule.colon-heading",
  "decorative-emoji": "prose.rule.decorative-emoji",
  "em-dash-series": "prose.rule.em-dash-series",
  "requester-reference": "prose.rule.requester-reference",
  "person-as-reason": "prose.rule.person-as-reason",
  "origin-project": "prose.rule.origin-project",
  "first-person": "prose.rule.first-person",
  padding: "prose.rule.padding",
  "time-estimate": "prose.rule.time-estimate",
} as const satisfies Readonly<Record<ProseRuleId, MessageKey>>;

const MAX_SPANS = 3;
const MAX_FIXES = 3;

export const rulesOf = (spans: readonly ProseSpan[]): readonly ProseRuleId[] => {
  const weights = new Map<ProseRuleId, number>();
  for (const hit of spans.flatMap((span) => span.hits))
    weights.set(hit.rule, (weights.get(hit.rule) ?? 0) + hit.weight);
  return [...weights].sort((left, right) => right[1] - left[1]).map(([rule]) => rule);
};

export const spanRules = (span: ProseSpan): string => {
  const seen = new Set<string>();
  return span.hits
    .filter((hit) => !seen.has(hit.rule) && seen.add(hit.rule))
    .map((hit) =>
      hit.rule === "crutch-word" || hit.rule === "opener-routine" ? `${hit.rule} "${hit.excerpt}"` : hit.rule,
    )
    .join(", ");
};

export const describeSpans = (t: Translate, spans: readonly ProseSpan[]): string =>
  spans
    .slice(0, MAX_SPANS)
    .map((span) => t("prose.span", { start: span.startLine, end: span.endLine, rules: spanRules(span) }))
    .join("; ");

export const describeFixes = (t: Translate, spans: readonly ProseSpan[]): string =>
  rulesOf(spans)
    .slice(0, MAX_FIXES)
    .map((rule) => t("prose.fix_item", { rule, fix: t(RULE_FIX_KEYS[rule]) }))
    .join("; ");
