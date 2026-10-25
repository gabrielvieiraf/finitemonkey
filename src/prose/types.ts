export const PROSE_RULE_IDS = [
  "opener-routine",
  "reassurance",
  "slogan-closer",
  "rhythmic-triplet",
  "imperative-fragment",
  "antithesis",
  "abstract-noun",
  "crutch-word",
  "colon-heading",
  "decorative-emoji",
  "em-dash-series",
  "requester-reference",
  "person-as-reason",
  "origin-project",
  "first-person",
  "padding",
] as const;

export type ProseRuleId = (typeof PROSE_RULE_IDS)[number];

export type UnitKind = "sentence" | "heading" | "item";

export interface ProseUnit {
  readonly text: string;
  readonly line: number;
  readonly paragraph: number;
  readonly section: number;
  readonly kind: UnitKind;
  readonly lastInParagraph: boolean;
  readonly closesSection: boolean;
}

export interface ProseHit {
  readonly rule: ProseRuleId;
  readonly line: number;
  readonly unit: number;
  readonly weight: number;
  readonly excerpt: string;
}

export interface ProseSpan {
  readonly startLine: number;
  readonly endLine: number;
  readonly score: number;
  readonly hits: readonly ProseHit[];
}

export interface ProseReport {
  readonly hits: readonly ProseHit[];
  readonly spans: readonly ProseSpan[];
  readonly allowed: boolean;
}

export const PROSE_CONTEXTS = ["docs", "record"] as const;

export type ProseContext = (typeof PROSE_CONTEXTS)[number];

export const DENSITY_WINDOW = 6;

export const DENSITY_THRESHOLD = 4;
