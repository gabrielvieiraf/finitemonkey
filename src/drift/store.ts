import type { JsonObject } from "../core/parsed.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { type DriftReport, type DriftWarning, INDICATORS } from "./sensor.js";

export const DRIFT_CACHE = "drift.json";

export const saveReport = (runtime: Pick<Runtime, "writeText" | "now">, paths: FmPaths, report: DriftReport): void => {
  writeJsonFile(runtime, paths.cache(DRIFT_CACHE), {
    at: runtime.now(),
    warnings: report.warnings.map((warning): JsonObject => ({ ...warning, changes: [...warning.changes] })),
  });
};

const warningOf = (value: unknown): DriftWarning | undefined => {
  if (!isRecord(value)) return undefined;
  const indicator = INDICATORS.find((item) => item === value["indicator"]);
  const { taskClass, since, baseline, current, changes } = value;
  if (indicator === undefined || (taskClass !== "small" && taskClass !== "large") || typeof since !== "string")
    return undefined;
  if (typeof baseline !== "number" || typeof current !== "number" || !Array.isArray(changes)) return undefined;
  return {
    indicator,
    taskClass,
    since,
    baseline,
    current,
    changes: changes.filter((item): item is string => typeof item === "string"),
  };
};

export const warningsOf = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly DriftWarning[] => {
  const raw = readJsonFile(runtime, paths.cache(DRIFT_CACHE))?.["warnings"];
  return Array.isArray(raw) ? raw.flatMap((item: unknown) => warningOf(item) ?? []) : [];
};
