import { isComputed, type Measure, MEASURES, type Role, type Sample } from "./bench-metrics-measures.js";
import type { MetricsInput } from "./bench-metrics-read.js";
import { percentile } from "./evidence-rates.js";

export const METRICS_SCHEMA = "finitemonkey/bench-metrics@1";

export interface GroupResult {
  readonly group: string;
  readonly n: number;
  readonly value: number;
}

interface ResultBase {
  readonly id: string;
  readonly issues: readonly number[];
  readonly title: string;
  readonly role: Role;
}

export type MeasureResult =
  | (ResultBase & {
      readonly status: "computed";
      readonly unit: string;
      readonly aggregate: "median" | "mean";
      readonly source: string;
      readonly n: number;
      readonly groups: readonly GroupResult[];
    })
  | (ResultBase & { readonly status: "no_data"; readonly source: string; readonly reason: string })
  | (ResultBase & { readonly status: "not_local"; readonly reason: string });

export interface MetricsReport {
  readonly schema: typeof METRICS_SCHEMA;
  readonly runs: string;
  readonly runCount: number;
  readonly measures: readonly MeasureResult[];
}

const round = (value: number): number => Number(value.toFixed(4));

const aggregateOf = (values: readonly number[], kind: "median" | "mean"): number =>
  round(kind === "median" ? percentile(values, 0.5) : values.reduce((sum, value) => sum + value, 0) / values.length);

const grouped = (samples: readonly Sample[], kind: "median" | "mean"): readonly GroupResult[] =>
  [...new Set(samples.map((sample) => sample.group))].sort().map((group) => {
    const values = samples.filter((sample) => sample.group === group).map((sample) => sample.value);
    return { group, n: values.length, value: aggregateOf(values, kind) };
  });

export const measureResult = (measure: Measure, input: MetricsInput): MeasureResult => {
  const base = { id: measure.id, issues: measure.issues, title: measure.title, role: measure.role };
  if (!isComputed(measure)) return { ...base, status: "not_local", reason: measure.reason };
  const samples = measure.samples(input);
  if (samples.length === 0) {
    return { ...base, status: "no_data", source: measure.source, reason: `no run carries ${measure.needs}` };
  }
  return {
    ...base,
    status: "computed",
    unit: measure.unit,
    aggregate: measure.aggregate,
    source: measure.source,
    n: samples.length,
    groups: grouped(samples, measure.aggregate),
  };
};

export const computeMetrics = (runs: string, input: MetricsInput): MetricsReport => ({
  schema: METRICS_SCHEMA,
  runs,
  runCount: input.runs.length,
  measures: MEASURES.map((measure) => measureResult(measure, input)),
});

const issueList = (issues: readonly number[]): string => issues.map((issue) => `#${String(issue)}`).join(", ");

const measureLines = (result: MeasureResult): readonly string[] => {
  const head = `${result.id} (${issueList(result.issues)}, ${result.role}): ${result.title}`;
  if (result.status === "not_local") return [head, `  not computable locally: ${result.reason}`];
  if (result.status === "no_data") return [head, `  no data in ${result.source}: ${result.reason}`];
  return [
    head,
    `  ${result.aggregate} in ${result.unit}, n ${String(result.n)}, from ${result.source}`,
    ...result.groups.map((group) => `  ${group.group}: ${String(group.value)} (n ${String(group.n)})`),
  ];
};

export const renderMetrics = (report: MetricsReport): string => {
  const computed = report.measures.filter((result) => result.status === "computed").length;
  return [
    `${String(report.runCount)} runs from ${report.runs}; ${String(computed)} of ${String(report.measures.length)} measures computed`,
    "",
    ...report.measures.flatMap((result) => [...measureLines(result), ""]),
  ]
    .join("\n")
    .trimEnd();
};
