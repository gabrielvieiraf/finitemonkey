import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";

const columnsOf = (table: string, value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((column) => `${table}.${column}`)
    : [];

export const parseSchema = (text: string): ReadonlySet<string> => {
  const json = parseJsonObject(text.trim());
  if (json.ok) return new Set(Object.entries(json.value).flatMap(([table, value]) => columnsOf(table, value)));
  return new Set(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[\w.-]+\.[\w-]+$/.test(line)),
  );
};

export type SchemaComparison =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "expectation-missing" | "expectation-empty"; readonly file: string }
  | { readonly ok: false; readonly reason: "missing"; readonly missing: readonly string[] };

export const compareSchema = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
  file: string,
  restored: string,
): SchemaComparison => {
  const read = runtime.readText(toAbsolutePath(join(root, file)));
  if (!read.ok) return { ok: false, reason: "expectation-missing", file };
  const expected = parseSchema(read.value);
  if (expected.size === 0) return { ok: false, reason: "expectation-empty", file };
  const actual = parseSchema(restored);
  const missing = [...expected].filter((column) => !actual.has(column)).sort();
  return missing.length === 0 ? { ok: true } : { ok: false, reason: "missing", missing };
};

export const comparisonDetail = (comparison: SchemaComparison): string => {
  if (comparison.ok) return "";
  return comparison.reason === "missing"
    ? `missing columns: ${comparison.missing.join(", ")}`
    : `${comparison.reason}: ${comparison.file}`;
};
