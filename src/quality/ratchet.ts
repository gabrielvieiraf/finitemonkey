import type { QualityLimits } from "./limits.js";
import type { FileMetrics, FunctionMetric } from "./metrics.js";

export const QUALITY_RULES = [
  "file_lines",
  "function_complexity",
  "function_nesting",
  "nested_ternary",
  "clone",
  "import_cycle",
  "file_lines_warn",
  "function_lines",
  "function_params",
  "call_chain",
  "statement_identifiers",
  "unused_export",
] as const;

export type QualityRule = (typeof QUALITY_RULES)[number];

export type QualityLevel = "block" | "warn";

export interface QualityFinding {
  readonly rule: QualityRule;
  readonly level: QualityLevel;
  readonly file: string;
  readonly line: number;
  readonly params: Readonly<Record<string, string | number>>;
}

export const grew = (before: number | undefined, after: number, limit: number): boolean =>
  after > limit && (before === undefined || after > before);

export const fileSizeFinding = (
  file: string,
  before: number | undefined,
  after: number,
  limits: QualityLimits,
): QualityFinding | undefined => {
  const params = { lines: after, before: before ?? 0 };
  if (grew(before, after, limits.fileLinesBlock)) {
    return { rule: "file_lines", level: "block", file, line: 1, params: { ...params, max: limits.fileLinesBlock } };
  }
  if (grew(before, after, limits.fileLinesWarn)) {
    return { rule: "file_lines_warn", level: "warn", file, line: 1, params: { ...params, max: limits.fileLinesWarn } };
  }
  return undefined;
};

type MetricName = "cognitive" | "nesting" | "lines" | "params" | "chain" | "identifiers";

const FUNCTION_RULES: readonly {
  readonly rule: QualityRule;
  readonly level: QualityLevel;
  readonly metric: MetricName;
  readonly limit: (limits: QualityLimits) => number;
}[] = [
  { rule: "function_complexity", level: "block", metric: "cognitive", limit: (l) => l.complexityBlock },
  { rule: "function_nesting", level: "block", metric: "nesting", limit: (l) => l.nestingBlock },
  { rule: "function_lines", level: "warn", metric: "lines", limit: (l) => l.functionLinesWarn },
  { rule: "function_params", level: "warn", metric: "params", limit: (l) => l.paramsWarn },
  { rule: "call_chain", level: "warn", metric: "chain", limit: (l) => l.chainWarn },
  { rule: "statement_identifiers", level: "warn", metric: "identifiers", limit: (l) => l.identifiersWarn },
];

const functionFindings = (
  file: string,
  before: ReadonlyMap<string, FunctionMetric>,
  fn: FunctionMetric,
  limits: QualityLimits,
): readonly QualityFinding[] =>
  FUNCTION_RULES.flatMap(({ rule, level, metric, limit }): QualityFinding[] => {
    const max = limit(limits);
    const old = before.get(fn.key)?.[metric];
    if (!grew(old, fn[metric], max)) return [];
    return [{ rule, level, file, line: fn.line, params: { name: fn.name, value: fn[metric], before: old ?? 0, max } }];
  });

const ternaryFindings = (file: string, before: FileMetrics | undefined, after: FileMetrics): QualityFinding[] => {
  const known = new Map<string, number>();
  for (const item of before?.nestedTernaries ?? []) known.set(item.text, (known.get(item.text) ?? 0) + 1);
  return after.nestedTernaries.flatMap((item): QualityFinding[] => {
    const left = known.get(item.text) ?? 0;
    if (left > 0) {
      known.set(item.text, left - 1);
      return [];
    }
    return [{ rule: "nested_ternary", level: "block", file, line: item.line, params: {} }];
  });
};

export const compareFile = (
  file: string,
  before: FileMetrics | undefined,
  after: FileMetrics,
  limits: QualityLimits,
): readonly QualityFinding[] => {
  const old = new Map((before?.functions ?? []).map((fn) => [fn.key, fn]));
  return [
    ...[fileSizeFinding(file, before?.lines, after.lines, limits) ?? []].flat(),
    ...after.functions.flatMap((fn) => functionFindings(file, old, fn, limits)),
    ...ternaryFindings(file, before, after),
  ];
};

export const blocking = (findings: readonly QualityFinding[]): readonly QualityFinding[] =>
  findings.filter((finding) => finding.level === "block");
