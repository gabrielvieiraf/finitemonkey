import { importEdges, type SourceTree } from "../arch/imports.js";
import { isRecord, type JsonObject } from "../core/parsed.js";
import type { Evidence } from "../evidence/types.js";
import { isTestFile } from "../guards/tests/patterns.js";

export const TEST_BUDGET_FEATURE = "test-budget";
export const DEFAULT_TOLERANCE = 0.3;
export const FLOOR_MS = 2_000;
export const BASE_RUNS = 5;

export interface SuiteRun {
  readonly treeHash: string;
  readonly at: string;
  readonly ms: number;
}

export const suiteRuns = (entries: readonly Evidence[]): readonly SuiteRun[] => {
  const byTree = new Map<string, SuiteRun>();
  for (const entry of entries) {
    if (entry.kind !== "tests" || entry.status !== "passed" || entry.durationMs === undefined) continue;
    byTree.set(entry.treeHash, { treeHash: entry.treeHash, at: entry.at, ms: entry.durationMs });
  }
  return [...byTree.values()].sort((left, right) => left.at.localeCompare(right.at));
};

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

export interface SlowSuite {
  readonly currentMs: number;
  readonly baseMs: number;
  readonly runs: number;
}

export const slowSuite = (runs: readonly SuiteRun[], tolerance = DEFAULT_TOLERANCE): SlowSuite | undefined => {
  const current = runs.at(-1);
  const base = runs.slice(-1 - BASE_RUNS, -1).map((run) => run.ms);
  if (current === undefined || base.length === 0) return undefined;
  const baseMs = median(base);
  const slow = current.ms > baseMs * (1 + tolerance) && current.ms - baseMs > FLOOR_MS;
  return slow ? { currentMs: current.ms, baseMs, runs: base.length } : undefined;
};

export interface TestCoverage {
  readonly lines: ReadonlySet<string>;
  readonly asserts: ReadonlySet<string>;
}

const stringSet = (value: unknown): ReadonlySet<string> =>
  new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

export const parseCoverage = (json: JsonObject): ReadonlyMap<string, TestCoverage> => {
  const tests = isRecord(json["tests"]) ? json["tests"] : {};
  return new Map(
    Object.entries(tests).flatMap(([id, value]): [string, TestCoverage][] =>
      isRecord(value) ? [[id, { lines: stringSet(value["lines"]), asserts: stringSet(value["asserts"]) }]] : [],
    ),
  );
};

const within = (small: ReadonlySet<string>, large: ReadonlySet<string>): boolean =>
  [...small].every((item) => large.has(item));

const sameSet = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
  left.size === right.size && within(left, right);

export interface Redundant {
  readonly test: string;
  readonly coveredBy: string;
}

export const redundantTests = (
  coverage: ReadonlyMap<string, TestCoverage>,
  keep: readonly string[],
): readonly Redundant[] => {
  const ids = [...coverage.keys()].sort();
  return ids.flatMap((id): Redundant[] => {
    if (keep.includes(id)) return [];
    const mine = coverage.get(id);
    if (mine === undefined || mine.lines.size === 0) return [];
    const other = ids.find((candidate) => {
      const theirs = coverage.get(candidate);
      if (candidate === id || theirs === undefined) return false;
      if (!within(mine.lines, theirs.lines) || !within(mine.asserts, theirs.asserts)) return false;
      const identical = sameSet(mine.lines, theirs.lines) && sameSet(mine.asserts, theirs.asserts);
      return !identical || candidate < id;
    });
    return other === undefined ? [] : [{ test: id, coveredBy: other }];
  });
};

export const linkedTests = (tree: SourceTree, touched: readonly string[]): readonly string[] => {
  const importers = new Map<string, string[]>();
  for (const edge of importEdges(tree)) importers.set(edge.to, [...(importers.get(edge.to) ?? []), edge.from]);
  const seen = new Set<string>(touched);
  const queue = [...touched];
  while (queue.length > 0) {
    const file = queue.shift() ?? "";
    for (const from of importers.get(file) ?? []) {
      if (seen.has(from)) continue;
      seen.add(from);
      queue.push(from);
    }
  }
  return [...seen].filter(isTestFile).sort();
};
