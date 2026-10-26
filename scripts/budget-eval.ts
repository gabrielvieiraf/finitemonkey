import type { Measure } from "./budget-measure.js";

export interface Budgets {
  readonly context: Readonly<Record<string, number>>;
  readonly latency: { readonly preToolUseP95MsPerGuard: number; readonly runs: number };
}

export interface Row {
  readonly group: "context" | "latency";
  readonly name: string;
  readonly value: number;
  readonly ceiling: number | undefined;
  readonly ok: boolean;
}

const isNumberMap = (value: unknown): value is Readonly<Record<string, number>> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((item) => typeof item === "number");

export const parseBudgets = (text: string): Budgets => {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || !("context" in parsed) || !("latency" in parsed)) {
    throw new Error("budgets.json needs context and latency");
  }
  const { context, latency } = parsed;
  if (!isNumberMap(context) || !isNumberMap(latency)) throw new Error("budgets.json values must be numbers");
  const perGuard = latency["preToolUseP95MsPerGuard"];
  const runs = latency["runs"];
  if (perGuard === undefined || runs === undefined) throw new Error("budgets.json latency needs both keys");
  return { context, latency: { preToolUseP95MsPerGuard: perGuard, runs } };
};

export const evaluate = (budgets: Budgets, context: readonly Measure[], guards: readonly Measure[]): readonly Row[] => [
  ...context.map((measure): Row => {
    const ceiling = budgets.context[measure.name];
    return { group: "context", ...measure, ceiling, ok: ceiling !== undefined && measure.value <= ceiling };
  }),
  ...guards.map((measure): Row => ({
    group: "latency",
    ...measure,
    ceiling: budgets.latency.preToolUseP95MsPerGuard,
    ok: measure.value <= budgets.latency.preToolUseP95MsPerGuard,
  })),
];

const shown = (row: Row, value: number | undefined): string =>
  value === undefined ? "none" : row.group === "latency" ? `${value.toFixed(1)} ms` : `${String(value)} B`;

export const summary = (rows: readonly Row[]): string =>
  [
    "### Context and hook latency budgets",
    "",
    "Ceilings live in `budgets.json`. Raising one means editing that file in the pull request.",
    "",
    "| Measure | Value | Ceiling | |",
    "|---|---|---|---|",
    ...rows.map(
      (row) =>
        `| ${row.group === "latency" ? `PreToolUse p95: ${row.name}` : row.name} | ${shown(row, row.value)} | ${shown(row, row.ceiling)} | ${row.ok ? "ok" : "over"} |`,
    ),
    "",
  ].join("\n");
