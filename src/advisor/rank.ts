import type { QualityLimits } from "../quality/limits.js";
import type { FileMetrics, FunctionMetric } from "../quality/metrics.js";
import { type AdvisorRule, REFACTORINGS } from "./types.js";

export const ADVISOR_COMPLEXITY = 10;

export interface Candidate {
  readonly rule: AdvisorRule;
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly metric: string;
  readonly value: number;
  readonly target: number;
  readonly refactoring: string;
  readonly score: number;
}

export interface TouchedMetrics {
  readonly file: string;
  readonly churn: number;
  readonly before: FileMetrics | undefined;
  readonly after: FileMetrics;
}

interface FunctionRule {
  readonly rule: AdvisorRule;
  readonly metric: keyof Pick<FunctionMetric, "cognitive" | "nesting" | "lines" | "params" | "chain" | "identifiers">;
  readonly over: (limits: QualityLimits) => number;
  readonly target: (limits: QualityLimits) => number;
}

const FUNCTION_RULES: readonly FunctionRule[] = [
  { rule: "deep_nesting", metric: "nesting", over: (l) => l.nestingBlock - 1, target: () => 2 },
  { rule: "complex_function", metric: "cognitive", over: () => ADVISOR_COMPLEXITY, target: () => ADVISOR_COMPLEXITY },
  { rule: "long_function", metric: "lines", over: (l) => l.functionLinesWarn, target: (l) => l.functionLinesWarn },
  { rule: "long_parameter_list", metric: "params", over: (l) => l.paramsWarn, target: () => 2 },
  { rule: "message_chain", metric: "chain", over: (l) => l.chainWarn, target: (l) => l.chainWarn },
  { rule: "busy_statement", metric: "identifiers", over: (l) => l.identifiersWarn, target: (l) => l.identifiersWarn },
];

const weight = (value: number, over: number, before: number | undefined, churn: number): number => {
  const grew = before === undefined || value > before ? 2 : 1;
  return Math.round((churn + 1) * (value / Math.max(1, over)) * grew * 100) / 100;
};

const functionCandidates = (item: TouchedMetrics, limits: QualityLimits): readonly Candidate[] => {
  const old = new Map((item.before?.functions ?? []).map((fn) => [fn.key, fn]));
  return item.after.functions.flatMap((fn): Candidate[] => {
    const rule = FUNCTION_RULES.find((entry) => fn[entry.metric] > entry.over(limits));
    if (rule === undefined) return [];
    const value = fn[rule.metric];
    return [
      {
        rule: rule.rule,
        file: item.file,
        line: fn.line,
        name: fn.name,
        metric: rule.metric,
        value,
        target: rule.target(limits),
        refactoring: REFACTORINGS[rule.rule],
        score: weight(value, rule.over(limits), old.get(fn.key)?.[rule.metric], item.churn),
      },
    ];
  });
};

const moduleCandidate = (item: TouchedMetrics, limits: QualityLimits): readonly Candidate[] =>
  item.after.lines > limits.fileLinesWarn
    ? [
        {
          rule: "large_module",
          file: item.file,
          line: 1,
          name: item.file,
          metric: "lines",
          value: item.after.lines,
          target: limits.fileLinesWarn,
          refactoring: REFACTORINGS.large_module,
          score: weight(item.after.lines, limits.fileLinesWarn, item.before?.lines, item.churn),
        },
      ]
    : [];

export interface RankFilter {
  readonly skip: (candidate: Candidate) => boolean;
  readonly max: number;
}

export const rankCandidates = (
  touched: readonly TouchedMetrics[],
  limits: QualityLimits,
  filter: RankFilter,
): readonly Candidate[] => {
  const all = touched
    .flatMap((item) => [...functionCandidates(item, limits), ...moduleCandidate(item, limits)])
    .filter((candidate) => !filter.skip(candidate))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);
  const seen = new Set<string>();
  return all
    .filter((candidate) => {
      const key = `${candidate.file}\u0000${candidate.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, filter.max);
};
