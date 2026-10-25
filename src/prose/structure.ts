import { IMPERATIVE_VERBS, STRUCTURE_WEIGHTS } from "./catalog.js";
import type { ProseHit, ProseRuleId, ProseUnit } from "./types.js";

const SHORT_SENTENCE = 6;
const SHORT_IMPERATIVE = 8;
const SHORT_CLOSER = 8;
const TRIAD_PART = 5;

const WORD = /[\p{L}\p{N}]/u;
const EMOJI = /\p{Extended_Pictographic}/u;
const COLON_HEADING = /^[^:]{1,40}:\s+\S/;
const ANTITHESIS_TAIL = /,\s+(?:not|never|não|nunca|no)\s+([^,;:]+)$/iu;
const NOT_BUT =
  /(?<![\p{L}])(?:not\s[^,.;]{1,40},\s*but|não\s[^,.;]{1,40},\s*mas|no\s[^,.;]{1,40},\s*sino)(?![\p{L}])/iu;
const NEGATION = /(?<![\p{L}])(?:is not|isn't|it's not|that's not|that is not|não é|no es)(?![\p{L}])/iu;
const AFFIRMATION = /^(?:it is|it's|this is|é|es|isso é|eso es)(?![\p{L}])/iu;

const CONNECTIVES: ReadonlySet<string> = new Set(
  "with in on at by for of to from if is are was never not x por em en com con de do da del se si é es são son nunca não no para que como".split(
    " ",
  ),
);

export const wordsOf = (text: string): readonly string[] => text.split(/\s+/).filter((word) => WORD.test(word));

const hit = (rule: ProseRuleId, units: readonly ProseUnit[], index: number, weight: number): ProseHit => {
  const unit = units[index];
  return { rule, unit: index, line: unit?.line ?? 0, weight, excerpt: unit?.text ?? "" };
};

const isProse = (unit: ProseUnit | undefined): unit is ProseUnit => unit?.kind === "sentence";

const samePara = (units: readonly ProseUnit[], from: number, count: number): boolean => {
  const first = units[from];
  if (!isProse(first)) return false;
  return units.slice(from, from + count).every((unit) => isProse(unit) && unit.paragraph === first.paragraph);
};

const runsOf = (
  units: readonly ProseUnit[],
  size: number,
  matches: (unit: ProseUnit) => boolean,
): readonly number[] => {
  const starts: number[] = [];
  for (let index = 0; index + size <= units.length; index += 1) {
    const window = units.slice(index, index + size);
    if (!samePara(units, index, size) || !window.every(matches)) continue;
    if (starts.at(-1) !== undefined && index - (starts.at(-1) ?? 0) < size) continue;
    starts.push(index);
  }
  return starts;
};

const isShort = (limit: number) => (unit: ProseUnit) => wordsOf(unit.text).length <= limit;

const isImperative = (unit: ProseUnit): boolean => {
  const [first] = wordsOf(unit.text);
  return isShort(SHORT_IMPERATIVE)(unit) && IMPERATIVE_VERBS.has((first ?? "").toLowerCase());
};

const isPhrase = (part: string): boolean => {
  const words = wordsOf(part);
  return words.length >= 2 && words.length <= TRIAD_PART && !CONNECTIVES.has((words[0] ?? "").toLowerCase());
};

const isCommaTriad = (unit: ProseUnit): boolean => {
  const parts = unit.text.replace(/[.!?…]+$/, "").split(/,\s*|\s+(?:and|e|y)\s+/);
  return parts.length === 3 && parts.every(isPhrase);
};

const triplets = (units: readonly ProseUnit[]): readonly ProseHit[] => [
  ...runsOf(units, 3, isShort(SHORT_SENTENCE)).map((index) =>
    hit("rhythmic-triplet", units, index, STRUCTURE_WEIGHTS.triplet),
  ),
  ...units.flatMap((unit, index) =>
    isProse(unit) && unit.lastInParagraph && isCommaTriad(unit)
      ? [hit("rhythmic-triplet", units, index, STRUCTURE_WEIGHTS.triplet)]
      : [],
  ),
];

const imperatives = (units: readonly ProseUnit[]): readonly ProseHit[] =>
  runsOf(units, 2, isImperative).map((index) => hit("imperative-fragment", units, index, STRUCTURE_WEIGHTS.imperative));

const closers = (units: readonly ProseUnit[]): readonly ProseHit[] =>
  units.flatMap((unit, index) => {
    const isCloser =
      isProse(unit) &&
      unit.lastInParagraph &&
      unit.closesSection &&
      index > 0 &&
      isShort(SHORT_CLOSER)(unit) &&
      !/\d/.test(unit.text);
    return isCloser ? [hit("slogan-closer", units, index, STRUCTURE_WEIGHTS.closer)] : [];
  });

const antitheses = (units: readonly ProseUnit[]): readonly ProseHit[] =>
  units.flatMap((unit, index) => {
    if (unit.kind === "heading") return [];
    const tail = ANTITHESIS_TAIL.exec(unit.text)?.[1];
    if ((tail !== undefined && wordsOf(tail).length <= SHORT_SENTENCE) || NOT_BUT.test(unit.text)) {
      return [hit("antithesis", units, index, STRUCTURE_WEIGHTS.antithesis)];
    }
    const next = units[index + 1];
    const paired = NEGATION.test(unit.text) && next?.paragraph === unit.paragraph && AFFIRMATION.test(next.text);
    return paired ? [hit("antithesis", units, index, STRUCTURE_WEIGHTS.antithesisPair)] : [];
  });

const headings = (units: readonly ProseUnit[]): readonly ProseHit[] =>
  units.flatMap((unit, index) =>
    unit.kind === "heading" && COLON_HEADING.test(unit.text)
      ? [hit("colon-heading", units, index, STRUCTURE_WEIGHTS.heading)]
      : [],
  );

const emoji = (units: readonly ProseUnit[]): readonly ProseHit[] =>
  units.flatMap((unit, index) =>
    EMOJI.test(unit.text) ? [hit("decorative-emoji", units, index, STRUCTURE_WEIGHTS.emoji)] : [],
  );

const dashes = (units: readonly ProseUnit[]): readonly ProseHit[] => {
  const perParagraph = new Map<number, number>();
  for (const unit of units) {
    const count = unit.text.split("—").length - 1;
    perParagraph.set(unit.paragraph, (perParagraph.get(unit.paragraph) ?? 0) + count);
  }
  return [...perParagraph].flatMap(([paragraph, count]) => {
    if (count === 0) return [];
    const index = units.findIndex((unit) => unit.paragraph === paragraph && unit.text.includes("—"));
    const weight = count >= 2 ? STRUCTURE_WEIGHTS.dashSeries : STRUCTURE_WEIGHTS.dash;
    return [hit("em-dash-series", units, index, weight)];
  });
};

export const structureHits = (units: readonly ProseUnit[]): readonly ProseHit[] => [
  ...triplets(units),
  ...imperatives(units),
  ...closers(units),
  ...antitheses(units),
  ...headings(units),
  ...emoji(units),
  ...dashes(units),
];
