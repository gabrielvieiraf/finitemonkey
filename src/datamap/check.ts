import type { AbsolutePath } from "../core/brand.js";
import { toAbsolutePath } from "../core/brand.js";
import { type DataMapRow, isComplete, keyOf, type MapRuntime, personalFields, readDataMap } from "./map.js";
import type { SchemaField } from "./schema.js";

export type DataMapProblem =
  | { readonly kind: "missing"; readonly field: SchemaField }
  | { readonly kind: "incomplete"; readonly field: SchemaField }
  | { readonly kind: "ai"; readonly key: string; readonly file: string; readonly line: number };

const AI_CLIENT =
  /from\s+["'](?:openai|@anthropic-ai\/sdk|@google\/genai|@google\/generative-ai|ai|@ai-sdk\/\w+)["']|^\s*(?:import|from)\s+(?:openai|anthropic|google\.genai|google\.generativeai)\b/m;

const aiProblems = (
  runtime: MapRuntime,
  root: AbsolutePath,
  files: readonly string[],
  rows: readonly DataMapRow[],
): readonly DataMapProblem[] =>
  files.flatMap((file) => {
    const read = runtime.readText(toAbsolutePath(file, root));
    if (!read.ok || !AI_CLIENT.test(read.value)) return [];
    const lines = read.value.split("\n");
    return rows
      .filter((row) => row.ai === "")
      .flatMap((row): DataMapProblem[] => {
        const name = row.field.slice(row.field.lastIndexOf(".") + 1);
        const index = lines.findIndex((line) => new RegExp(`[.?]${name}\\b|\\[["']${name}["']\\]`).test(line));
        return index === -1 ? [] : [{ kind: "ai", key: row.field, file, line: index + 1 }];
      });
  });

export const dataMapProblems = (
  runtime: MapRuntime,
  root: AbsolutePath,
  changedSources: readonly string[] = [],
): readonly DataMapProblem[] => {
  const rows = readDataMap(runtime, root);
  const byKey = new Map(rows.map((row) => [row.field, row]));
  const seen = new Set<string>();
  const fieldProblems = personalFields(runtime, root).flatMap((field): DataMapProblem[] => {
    const key = keyOf(field);
    if (seen.has(key)) return [];
    seen.add(key);
    const row = byKey.get(key);
    if (row === undefined) return [{ kind: "missing", field }];
    return isComplete(row) ? [] : [{ kind: "incomplete", field }];
  });
  return [...fieldProblems, ...aiProblems(runtime, root, changedSources, rows)];
};
