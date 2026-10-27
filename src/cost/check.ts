import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, loadProjectConfig } from "../git/project-config.js";
import { PLAN_DIR, planFiles, planPath } from "../plan/folder.js";
import { type CsvRow, parseCsv } from "./csv.js";

export const COST_SCHEMA = "finitemonkey/cost@1";
export const DEFAULT_VALIDITY_DAYS = 90;

export const COST_ISSUES = [
  "missing_source",
  "missing_date",
  "expired",
  "limit_exceeds_next_layer",
  "unreadable",
] as const;

export type CostIssueKind = (typeof COST_ISSUES)[number];

export interface CostIssue {
  readonly kind: CostIssueKind;
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

export interface CostChecked {
  readonly files: number;
  readonly validityDays: number;
  readonly issues: readonly CostIssue[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

type Issue = Omit<CostIssue, "file">;

const column = (header: CsvRow, name: string): number => header.indexOf(name);

const sourced = (row: CsvRow, header: CsvRow, line: number, label: string, oldest: number): readonly Issue[] => {
  const source = (row[column(header, "source")] ?? "").trim();
  const date = (row[column(header, "date")] ?? "").trim();
  if (source === "") return [{ kind: "missing_source", line, detail: label }];
  if (!DATE.test(date) || Number.isNaN(Date.parse(date))) return [{ kind: "missing_date", line, detail: label }];
  return Date.parse(date) < oldest ? [{ kind: "expired", line, detail: `${label} (${date})` }] : [];
};

const modelIssues = (rows: readonly CsvRow[], oldest: number): readonly Issue[] => {
  const [header = [], ...body] = rows;
  if (column(header, "type") === -1 || column(header, "source") === -1 || column(header, "date") === -1)
    return [{ kind: "unreadable", line: 1, detail: "id,unit,type,source,date" }];
  return body.flatMap((row, index) =>
    row[column(header, "type")] === "FACT" ? sourced(row, header, index + 2, row[0] ?? "", oldest) : [],
  );
};

const limitIssues = (rows: readonly CsvRow[], oldest: number): readonly Issue[] => {
  const [header = [], ...body] = rows;
  if (column(header, "accepted") === -1 || column(header, "next_value") === -1)
    return [
      { kind: "unreadable", line: 1, detail: "provider,limit,value,unit,accepted,next_layer,next_value,source,date" },
    ];
  return body.flatMap((row, index) => {
    const label = `${row[0] ?? ""} ${row[1] ?? ""}`.trim();
    const accepted = Number(row[column(header, "accepted")]);
    const next = Number(row[column(header, "next_value")]);
    const over = Number.isFinite(accepted) && Number.isFinite(next) && accepted > next;
    return [
      ...sourced(row, header, index + 2, label, oldest),
      ...(over
        ? [
            {
              kind: "limit_exceeds_next_layer" as const,
              line: index + 2,
              detail: `${label}: ${String(accepted)} > ${String(next)} (${row[column(header, "next_layer")] ?? ""})`,
            },
          ]
        : []),
    ];
  });
};

export const validityDays = (runtime: Runtime, root: AbsolutePath): number => {
  const value = configAt(loadProjectConfig(runtime, root), "cost", "validity_days");
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_VALIDITY_DAYS;
};

export const checkCost = (runtime: Runtime, root: AbsolutePath): CostChecked => {
  const days = validityDays(runtime, root);
  const oldest = Date.parse(runtime.now()) - days * DAY_MS;
  const names = planFiles(runtime, root).filter(
    (name) => name.endsWith("-cost-model.csv") || name.endsWith("-cost-limits.csv"),
  );
  const issues = names.flatMap((name) => {
    const text = runtime.readText(planPath(root, name));
    const rows = text.ok ? parseCsv(text.value) : [];
    const found = name.endsWith("-cost-model.csv") ? modelIssues(rows, oldest) : limitIssues(rows, oldest);
    return found.map((item) => ({ ...item, file: `${PLAN_DIR}/${name}` }));
  });
  return { files: names.length, validityDays: days, issues };
};
