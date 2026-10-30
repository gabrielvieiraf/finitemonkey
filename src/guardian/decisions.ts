import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";

export const DECISIONS_LOG = "decisions.jsonl";
export const DECISION_SOURCES = ["decide", "report"] as const;
export const DECISION_CHOICES = ["followed", "overridden", "pending"] as const;

export type DecisionSource = (typeof DECISION_SOURCES)[number];
export type DecisionChoice = (typeof DECISION_CHOICES)[number];

export interface DecisionEntry {
  readonly id: string;
  readonly source: DecisionSource;
  readonly at: string;
  readonly subject: string;
  readonly recommendation: string;
  readonly evidence: readonly string[];
  readonly decision: DecisionChoice;
  readonly paths: readonly string[];
  readonly criterion?: string;
  readonly choice?: string;
  readonly overrideReason?: string;
  readonly trigger?: string;
}

export const decisionsPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, DECISIONS_LOG));

const texts = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const optional = (record: JsonObject, key: string): Partial<Record<string, string>> => {
  const value = record[key];
  return typeof value === "string" && value !== "" ? { [key]: value } : {};
};

const entryOf = (record: JsonObject): DecisionEntry | undefined => {
  const { id, at, subject, recommendation } = record;
  const source = DECISION_SOURCES.find((item) => item === record["source"]);
  const decision = DECISION_CHOICES.find((item) => item === record["decision"]);
  if (typeof id !== "string" || typeof at !== "string" || typeof subject !== "string") return undefined;
  if (typeof recommendation !== "string" || source === undefined || decision === undefined) return undefined;
  return {
    id,
    source,
    at,
    subject,
    recommendation,
    evidence: texts(record["evidence"]),
    decision,
    paths: texts(record["paths"]),
    ...optional(record, "criterion"),
    ...optional(record, "choice"),
    ...optional(record, "overrideReason"),
    ...optional(record, "trigger"),
  };
};

export const readDecisions = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly DecisionEntry[] => {
  const text = runtime.readText(decisionsPath(paths));
  if (!text.ok) return [];
  return text.value.split("\n").flatMap((line) => {
    const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
    const entry = parsed?.ok === true && isRecord(parsed.value) ? entryOf(parsed.value) : undefined;
    return entry === undefined ? [] : [entry];
  });
};

export const nextDecisionId = (entries: readonly DecisionEntry[]): string =>
  `d${String(
    Math.max(0, ...entries.map((entry) => Number.parseInt(entry.id.replace(/^d/, ""), 10)).filter(Number.isFinite)) + 1,
  )}`;

export const appendDecision = (
  runtime: Pick<Runtime, "appendText" | "readText">,
  paths: FmPaths,
  entry: Omit<DecisionEntry, "id">,
): DecisionEntry | undefined => {
  const full = { id: nextDecisionId(readDecisions(runtime, paths)), ...entry };
  return runtime.appendText(decisionsPath(paths), `${JSON.stringify(full)}\n`).ok ? full : undefined;
};

export const forgetDecision = (
  runtime: Pick<Runtime, "readText" | "writeText">,
  paths: FmPaths,
  id: string,
): boolean => {
  const entries = readDecisions(runtime, paths);
  if (!entries.some((entry) => entry.id === id)) return false;
  const kept = entries.filter((entry) => entry.id !== id);
  return runtime.writeText(decisionsPath(paths), kept.map((entry) => `${JSON.stringify(entry)}\n`).join("")).ok;
};
