import { matchesAny } from "../core/glob.js";
import { isTestFile } from "../guards/tests/patterns.js";
import { isGeneratedPath } from "../wt/generated.js";
import type { History } from "./history.js";

export const DEFAULT_SENSITIVE = [
  "**/auth/**",
  "**/*auth*",
  "**/payment*/**",
  "**/billing/**",
  "**/crypto/**",
  "**/secret*",
] as const;

export const WEIGHTS = { base: 100, importers: 10, untested: 10, fixes: 10, sensitive: 10 } as const;

const SOURCE = /\.(?:[cm]?[jt]sx?|py|go|java|kt|rb|php|rs|cs)$/;
const BRANCH = /\b(?:if|for|while|case|catch|elif|except|switch)\b|&&|\|\||\?\?/g;

export interface FileFacts {
  readonly path: string;
  readonly lines: number;
  readonly complexity: number;
  readonly importers: number;
  readonly hasTest: boolean;
}

export interface Hotspot {
  readonly path: string;
  readonly score: number;
  readonly churn: number;
  readonly complexity: number;
  readonly lines: number;
  readonly importers: number;
  readonly fixes: number;
  readonly hasTest: boolean;
  readonly sensitive: boolean;
}

export const isRankable = (path: string): boolean => SOURCE.test(path) && !isTestFile(path) && !isGeneratedPath(path);

export const branchComplexity = (text: string): number => 1 + (text.match(BRANCH)?.length ?? 0);

const percentile = (values: readonly number[]): ((value: number) => number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (value) => {
    if (sorted.length <= 1) return value > 0 ? 1 : 0;
    const below = sorted.filter((item) => item < value).length;
    return below / (sorted.length - 1);
  };
};

const round = (value: number): number => Math.round(value * 100) / 100;

export const rankHotspots = (
  facts: readonly FileFacts[],
  history: History,
  sensitive: readonly string[],
): readonly Hotspot[] => {
  const raw = facts.map((fact) => {
    const past = history.files.get(fact.path) ?? { churn: 0, fixes: 0 };
    return { fact, past, base: past.churn * fact.complexity * Math.log(Math.max(fact.lines, 1)) };
  });
  const baseP = percentile(raw.map((item) => item.base));
  const importP = percentile(raw.map((item) => item.fact.importers));
  const fixP = percentile(raw.map((item) => item.past.fixes));
  return raw
    .map(({ fact, past, base }): Hotspot => {
      const touchy = matchesAny(fact.path, sensitive);
      const score =
        WEIGHTS.base * baseP(base) +
        WEIGHTS.importers * importP(fact.importers) +
        (fact.hasTest ? 0 : WEIGHTS.untested) +
        WEIGHTS.fixes * fixP(past.fixes) +
        (touchy ? WEIGHTS.sensitive : 0);
      return {
        path: fact.path,
        score: round(score),
        churn: past.churn,
        complexity: fact.complexity,
        lines: fact.lines,
        importers: fact.importers,
        fixes: past.fixes,
        hasTest: fact.hasTest,
        sensitive: touchy,
      };
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
};
