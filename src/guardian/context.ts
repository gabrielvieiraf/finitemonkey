import { isRecord } from "../core/parsed.js";
import type { Goals, Origin } from "./goals.js";

export const STAGES = ["idea", "first-customers", "growing", "stable"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_BUDGET: Readonly<Record<Stage, number>> = {
  idea: 1,
  "first-customers": 1,
  growing: 2,
  stable: 3,
};

export const MOST_PERMISSIVE_BUDGET = 3;

export interface ContextField<T> {
  readonly value: T;
  readonly origin: Origin;
}

export interface CompanyContext {
  readonly stage?: ContextField<Stage>;
  readonly demonstrated: readonly ContextField<string>[];
  readonly operates?: ContextField<string>;
  readonly milestone?: ContextField<string>;
}

const fieldOf = (raw: unknown): ContextField<string> | undefined => {
  if (typeof raw === "string" && raw.trim() !== "") return { value: raw.trim(), origin: "inferred" };
  if (!isRecord(raw)) return undefined;
  const value = raw["value"];
  const origin = raw["origin"] === "stated" ? "stated" : "inferred";
  return typeof value === "string" && value.trim() !== "" ? { value: value.trim(), origin } : undefined;
};

const listOf = (raw: unknown): readonly ContextField<string>[] => {
  if (isRecord(raw) && Array.isArray(raw["value"])) {
    const origin = raw["origin"] === "stated" ? "stated" : "inferred";
    return raw["value"].flatMap((item: unknown) =>
      typeof item === "string" && item.trim() !== "" ? [{ value: item.trim().toLowerCase(), origin }] : [],
    );
  }
  return Array.isArray(raw)
    ? raw.flatMap((item: unknown) => {
        const field = fieldOf(item);
        return field === undefined ? [] : [{ ...field, value: field.value.toLowerCase() }];
      })
    : [];
};

export const companyContext = (goals: Goals): CompanyContext => {
  const raw = goals.extra["context"];
  if (!isRecord(raw)) return { demonstrated: [] };
  const stageField = fieldOf(raw["stage"]);
  const stage = STAGES.find((item) => item === stageField?.value);
  const operates = fieldOf(raw["operates"]);
  const milestone = fieldOf(raw["milestone"]);
  return {
    ...(stage === undefined || stageField === undefined ? {} : { stage: { value: stage, origin: stageField.origin } }),
    demonstrated: listOf(raw["demonstrated"]),
    ...(operates === undefined ? {} : { operates }),
    ...(milestone === undefined ? {} : { milestone }),
  };
};

export const raisingBudget = (context: CompanyContext): number =>
  context.stage?.origin === "stated" ? STAGE_BUDGET[context.stage.value] : MOST_PERMISSIVE_BUDGET;
