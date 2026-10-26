import { type PhraseRule, phraseRules } from "./catalog.js";
import { extractProse } from "./extract.js";
import { recordRules } from "./record-catalog.js";
import { structureHits } from "./structure.js";
import {
  DENSITY_THRESHOLD,
  DENSITY_WINDOW,
  type ProseContext,
  type ProseHit,
  type ProseReport,
  type ProseSpan,
  type ProseUnit,
} from "./types.js";

export interface ScoreOptions {
  readonly window?: number;
  readonly threshold?: number;
  readonly context?: ProseContext;
}

const phraseHits = (units: readonly ProseUnit[], catalog: readonly PhraseRule[]): readonly ProseHit[] =>
  units.flatMap((unit, index) =>
    catalog.flatMap(({ rule, weight, patterns }) => {
      const match = patterns.map((pattern) => pattern.exec(unit.text)).find((found) => found !== null);
      return match === undefined ? [] : [{ rule, unit: index, line: unit.line, weight, excerpt: match[0] }];
    }),
  );

interface Window {
  readonly from: number;
  readonly to: number;
}

const windowEnd = (units: readonly ProseUnit[], from: number, size: number): number => {
  const section = units[from]?.section;
  let to = from;
  while (to + 1 < Math.min(units.length, from + size) && units[to + 1]?.section === section) to += 1;
  return to;
};

const windowScore = (hits: readonly ProseHit[], window: Window): number =>
  hits.filter((item) => item.unit >= window.from && item.unit <= window.to).reduce((sum, item) => sum + item.weight, 0);

const hotWindows = (hits: readonly ProseHit[], units: readonly ProseUnit[], size: number, threshold: number) => {
  const windows: Window[] = [];
  for (let from = 0; from < units.length; from += 1) {
    const window = { from, to: windowEnd(units, from, size) };
    if (windowScore(hits, window) >= threshold) windows.push(window);
  }
  return windows;
};

const spanOf = (hits: readonly ProseHit[], from: number, to: number): ProseSpan => {
  const inside = hits.filter((item) => item.unit >= from && item.unit <= to);
  const lines = inside.map((item) => item.line);
  return {
    startLine: Math.min(...lines),
    endLine: Math.max(...lines),
    score: inside.reduce((sum, item) => sum + item.weight, 0),
    hits: inside,
  };
};

const mergeSpans = (hits: readonly ProseHit[], windows: readonly Window[]): readonly ProseSpan[] => {
  const ranges: [number, number][] = [];
  for (const { from, to } of windows) {
    const previous = ranges.at(-1);
    if (previous !== undefined && from <= previous[1] + 1) previous[1] = Math.max(previous[1], to);
    else ranges.push([from, to]);
  }
  return ranges.map(([from, to]) => spanOf(hits, from, to)).filter((span) => span.hits.length > 0);
};

const byPosition = (left: ProseHit, right: ProseHit): number => left.unit - right.unit || left.line - right.line;

export const scoreProse = (text: string, options: ScoreOptions = {}): ProseReport => {
  const { units, allowed } = extractProse(text);
  const size = options.window ?? DENSITY_WINDOW;
  const threshold = options.threshold ?? DENSITY_THRESHOLD;
  const catalog = options.context === "record" ? [...phraseRules(), ...recordRules()] : phraseRules();
  const hits = [...phraseHits(units, catalog), ...structureHits(units)].sort(byPosition);
  const spans = mergeSpans(hits, hotWindows(hits, units, size, threshold));
  return { hits, spans, allowed };
};

export const isFlagged = (report: ProseReport): boolean => report.spans.length > 0;
