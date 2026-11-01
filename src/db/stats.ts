import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { withoutComments } from "./locks.js";

export interface TableSize {
  readonly table: string;
  readonly rows: number;
  readonly bytes: number | undefined;
}

export type Stats = { readonly ok: true; readonly sizes: readonly TableSize[] } | { readonly ok: false };

const sizeOf = (table: string, value: unknown): TableSize | undefined => {
  if (typeof value === "number") return { table, rows: value, bytes: undefined };
  if (!isRecord(value) || typeof value["rows"] !== "number") return undefined;
  const bytes = value["bytes"];
  return { table, rows: value["rows"], bytes: typeof bytes === "number" ? bytes : undefined };
};

export const readStats = (runtime: Pick<Runtime, "readText">, root: AbsolutePath, file: string): Stats => {
  const read = runtime.readText(toAbsolutePath(join(root, file)));
  const parsed = read.ok ? parseJsonObject(read.value) : undefined;
  if (parsed?.ok !== true) return { ok: false };
  return {
    ok: true,
    sizes: Object.entries(parsed.value).flatMap(([table, value]) => {
      const size = sizeOf(table, value);
      return size === undefined ? [] : [size];
    }),
  };
};

const TOUCHED =
  /\b(?:ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?|DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?|\bON\s+(?:ONLY\s+)?|UPDATE\s+|DELETE\s+FROM\s+)([\w."`]+)/gi;

export const touchedTables = (source: string): readonly string[] => [
  ...new Set(
    [...withoutComments(source).matchAll(TOUCHED)].map((match) => (match[1] ?? "").replace(/["`]/g, "").toLowerCase()),
  ),
];

const matches = (table: string, stat: string): boolean => {
  const name = stat.toLowerCase();
  return name === table || name.split(".").pop() === table.split(".").pop();
};

export const sizesFor = (stats: Stats, tables: readonly string[]): readonly TableSize[] =>
  stats.ok ? stats.sizes.filter((size) => tables.some((table) => matches(table, size.table))) : [];
