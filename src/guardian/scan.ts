import type { Runtime } from "../core/runtime.js";
import type { Translate } from "../i18n/translate.js";
import type { FmPaths } from "../task/paths.js";
import { diffSnapshot, existingMatches } from "./existing.js";
import type { RealityReport } from "./report.js";
import { reuseReport } from "./reuse-report.js";
import { activeTask } from "./tasks.js";

export const SCAN_FEATURES = ["guardian-reuse"] as const;
export type ScanFeature = (typeof SCAN_FEATURES)[number];

export interface ScanReport {
  readonly feature: ScanFeature;
  readonly report: RealityReport;
}

export interface ScanResult {
  readonly reports: readonly ScanReport[];
}

type ScanRuntime = Pick<Runtime, "readText" | "exec" | "listDir">;

export const scanChange = (runtime: ScanRuntime, t: Translate, paths: FmPaths, base: string): ScanResult => {
  const goal = activeTask(runtime, paths)?.contract.goal ?? "";
  const snap = diffSnapshot(runtime, paths, base);
  const reuse = existingMatches(runtime, paths.root, snap).map((match) => ({
    feature: "guardian-reuse" as const,
    report: reuseReport(t, match, goal),
  }));
  return { reports: reuse };
};
