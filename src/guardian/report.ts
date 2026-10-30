import { isRecord } from "../core/parsed.js";
import type { MessageKey } from "../i18n/catalogs.js";
import type { Translate } from "../i18n/translate.js";

export const INTERVENTION_LEVELS = [0, 1, 2, 3, 4, 5] as const;
export type InterventionLevel = (typeof INTERVENTION_LEVELS)[number];

export const TRIGGER_IDS = ["scope_growth", "goal_conflict", "reuse", "irreversible", "proportionality"] as const;
export type TriggerId = (typeof TRIGGER_IDS)[number];

export const LEVEL_OF: Readonly<Record<TriggerId, InterventionLevel>> = {
  scope_growth: 1,
  goal_conflict: 2,
  reuse: 2,
  proportionality: 2,
  irreversible: 3,
};

export const CERTAINTIES = ["high", "medium", "low"] as const;
export type Certainty = (typeof CERTAINTIES)[number];

export interface RealityReport {
  readonly trigger: TriggerId;
  readonly level: InterventionLevel;
  readonly perceivedGoal: string;
  readonly request: string;
  readonly finding: string;
  readonly evidence: readonly string[];
  readonly assumptions: readonly string[];
  readonly consequences: string;
  readonly alternatives: readonly string[];
  readonly recommendation: string;
  readonly certainty: Certainty;
  readonly nextStep: string;
  readonly paths: readonly string[];
  readonly key: string;
}

export const showable = (report: RealityReport): boolean =>
  report.evidence.some((line) => line.trim() !== "") && report.finding.trim() !== "";

const FIELDS = [
  "perceivedGoal",
  "request",
  "finding",
  "evidence",
  "assumptions",
  "consequences",
  "alternatives",
  "recommendation",
  "certainty",
  "nextStep",
] as const;

const labelKey = (field: (typeof FIELDS)[number]): MessageKey => `guardian.report.${field}`;

const valueOf = (report: RealityReport, field: (typeof FIELDS)[number]): readonly string[] => {
  const value = report[field];
  if (typeof value === "string") return value === "" ? [] : [value];
  return value;
};

export const renderReport = (t: Translate, report: RealityReport): string =>
  [
    t("guardian.report.title", { level: report.level, trigger: report.trigger }),
    ...FIELDS.flatMap((field) => {
      const lines = valueOf(report, field);
      if (lines.length === 0) return [];
      if (lines.length === 1) return [`${t(labelKey(field))}: ${lines[0] ?? ""}`];
      return [`${t(labelKey(field))}:`, ...lines.map((line) => `  - ${line}`)];
    }),
  ].join("\n");

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const textOf = (record: Readonly<Record<string, unknown>>, key: string): string => {
  const value = record[key];
  return typeof value === "string" ? value : "";
};

export const parseReport = (raw: unknown): RealityReport | undefined => {
  if (!isRecord(raw)) return undefined;
  const record = raw;
  const trigger = TRIGGER_IDS.find((item) => item === record["trigger"]);
  const certainty = CERTAINTIES.find((item) => item === record["certainty"]) ?? "low";
  if (trigger === undefined) return undefined;
  return {
    trigger,
    level: LEVEL_OF[trigger],
    perceivedGoal: textOf(record, "perceivedGoal"),
    request: textOf(record, "request"),
    finding: textOf(record, "finding"),
    evidence: strings(record["evidence"]),
    assumptions: strings(record["assumptions"]),
    consequences: textOf(record, "consequences"),
    alternatives: strings(record["alternatives"]),
    recommendation: textOf(record, "recommendation"),
    certainty,
    nextStep: textOf(record, "nextStep"),
    paths: strings(record["paths"]),
    key: textOf(record, "key"),
  };
};
