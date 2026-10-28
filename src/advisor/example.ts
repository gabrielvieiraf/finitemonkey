import type { FileMetrics, FunctionMetric } from "../quality/metrics.js";
import { wordsOf } from "../slop/names.js";
import type { Candidate } from "./rank.js";

export interface NearbyFile {
  readonly file: string;
  readonly metrics: FileMetrics;
}

const MIN_LINES = 3;

const leading = (name: string): string => wordsOf(name)[0] ?? "";

const metricOf = (fn: FunctionMetric, metric: string): number | undefined => {
  if (metric === "cognitive") return fn.cognitive;
  if (metric === "nesting") return fn.nesting;
  if (metric === "lines") return fn.lines;
  if (metric === "params") return fn.params;
  if (metric === "chain") return fn.chain;
  return metric === "identifiers" ? fn.identifiers : undefined;
};

export const exampleFor = (candidate: Candidate, nearby: readonly NearbyFile[]): string | undefined => {
  if (candidate.rule === "large_module") return undefined;
  const verb = leading(candidate.name);
  const matches = nearby.flatMap(({ file, metrics }) =>
    metrics.functions
      .filter((fn) => !(file === candidate.file && fn.name === candidate.name) && fn.lines >= MIN_LINES)
      .filter((fn) => verb !== "" && leading(fn.name) === verb)
      .flatMap((fn) => {
        const value = metricOf(fn, candidate.metric);
        return value !== undefined && value <= candidate.target ? [{ file, fn, value }] : [];
      }),
  );
  const best = matches.sort((a, b) => b.fn.lines - a.fn.lines || a.value - b.value)[0];
  return best === undefined ? undefined : `${best.file}:${String(best.fn.line)} ${best.fn.name}`;
};
