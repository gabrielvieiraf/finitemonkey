import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { maskText } from "../mask/mask.js";

export const VIOLATIONS_FILE = "rule-violations.jsonl";
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

export const recordViolation = (
  runtime: Pick<Runtime, "appendText" | "now">,
  dir: AbsolutePath,
  entry: Omit<Violation, "at">,
): void => {
  const detail = maskText(entry.detail).slice(0, MAX_DETAIL);
  runtime.appendText(violationsPath(dir), `${JSON.stringify({ at: runtime.now(), ...entry, detail })}\n`);
};

export const violationCounts = (violations: readonly Violation[]): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const violation of violations) counts.set(violation.rule, (counts.get(violation.rule) ?? 0) + 1);
  return counts;
};
