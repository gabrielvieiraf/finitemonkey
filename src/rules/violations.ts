import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { maskText } from "../mask/mask.js";

export const VIOLATIONS_FILE = "rule-violations.jsonl";
export const SUMMARY_FILE = "rule-violations.json";
export const VIOLATION_SOURCES = ["guard", "stop", "person"] as const;
export const MAX_DETAIL = 200;

export type ViolationSource = (typeof VIOLATION_SOURCES)[number];

export interface Violation {
  readonly at: string;
  readonly session: string;
  readonly rule: string;
  readonly source: ViolationSource;
  readonly detail: string;
}

export const violationsPath = (dir: AbsolutePath): AbsolutePath => toAbsolutePath(join(dir, VIOLATIONS_FILE));

const text = (raw: JsonObject, key: string): string => {
  const value = raw[key];
  return typeof value === "string" ? value : "";
};

const parseViolation = (raw: JsonObject): Violation | undefined => {
  const source = VIOLATION_SOURCES.find((item) => item === raw["source"]);
  const rule = text(raw, "rule");
  if (source === undefined || rule === "") return undefined;
  return { at: text(raw, "at"), session: text(raw, "session"), rule, source, detail: text(raw, "detail") };
};

export const readViolations = (runtime: Pick<Runtime, "readText">, dir: AbsolutePath): readonly Violation[] => {
  const raw = runtime.readText(violationsPath(dir));
  if (!raw.ok) return [];
  return raw.value.split("\n").flatMap((line) => {
    const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
    const violation = parsed?.ok === true ? parseViolation(parsed.value) : undefined;
    return violation === undefined ? [] : [violation];
  });
};

export interface ViolationSummary {
  readonly counts: Readonly<Record<string, number>>;
  readonly pending: readonly string[];
}

export const summaryPath = (dir: AbsolutePath): AbsolutePath => toAbsolutePath(join(dir, "cache", SUMMARY_FILE));

const numbers = (value: unknown): Readonly<Record<string, number>> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
      )
    : {};

export const readSummary = (runtime: Pick<Runtime, "readText">, dir: AbsolutePath): ViolationSummary => {
  const raw = runtime.readText(summaryPath(dir));
  const parsed = raw.ok ? parseJsonObject(raw.value) : undefined;
  if (parsed?.ok !== true) return { counts: {}, pending: [] };
  const pending = parsed.value["pending"];
  return {
    counts: numbers(parsed.value["counts"]),
    pending: Array.isArray(pending) ? pending.filter((item): item is string => typeof item === "string") : [],
  };
};

export const writeSummary = (
  runtime: Pick<Runtime, "writeText" | "mkdir">,
  dir: AbsolutePath,
  summary: ViolationSummary,
): void => {
  runtime.mkdir(toAbsolutePath(join(dir, "cache")));
  runtime.writeText(summaryPath(dir), `${JSON.stringify(summary)}\n`);
};

export const recordViolation = (
  runtime: Pick<Runtime, "appendText" | "now" | "readText" | "writeText" | "mkdir">,
  dir: AbsolutePath,
  entry: Omit<Violation, "at">,
): void => {
  const detail = maskText(entry.detail).slice(0, MAX_DETAIL);
  runtime.appendText(violationsPath(dir), `${JSON.stringify({ at: runtime.now(), ...entry, detail })}\n`);
  const before = readSummary(runtime, dir);
  writeSummary(runtime, dir, {
    counts: { ...before.counts, [entry.rule]: (before.counts[entry.rule] ?? 0) + 1 },
    pending: [...new Set([...before.pending, entry.rule])],
  });
};

export const violationCounts = (violations: readonly Violation[]): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const violation of violations) counts.set(violation.rule, (counts.get(violation.rule) ?? 0) + 1);
  return counts;
};
