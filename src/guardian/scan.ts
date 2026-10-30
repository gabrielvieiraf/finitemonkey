import type { Runtime } from "../core/runtime.js";
import { DECISION_FILE } from "../decide/check.js";
import type { Translate } from "../i18n/translate.js";
import { planFiles, planPath } from "../plan/folder.js";
import type { FmPaths } from "../task/paths.js";
import { companyContext } from "./context.js";
import { diffSnapshot, existingMatches } from "./existing.js";
import { readGoals } from "./goals.js";
import { problemWeight, type Proportion, proportionReport, weigh } from "./proportion.js";
import { statusOf } from "./record.js";
import type { RealityReport } from "./report.js";
import { reuseReport } from "./reuse-report.js";
import { activeTask } from "./tasks.js";
import { type SolutionWeight, solutionWeight } from "./weight.js";

export const SCAN_FEATURES = ["guardian-reuse", "proportionality"] as const;
export type ScanFeature = (typeof SCAN_FEATURES)[number];

export interface ScanReport {
  readonly feature: ScanFeature;
  readonly report: RealityReport;
}

export interface ScanResult {
  readonly weight: SolutionWeight;
  readonly proportion: Proportion;
  readonly reports: readonly ScanReport[];
}

type ScanRuntime = Pick<Runtime, "readText" | "exec" | "listDir">;

const decidedConcept =
  (runtime: ScanRuntime, paths: FmPaths) =>
  (concept: string): boolean =>
    planFiles(runtime, paths.root)
      .filter((name) => DECISION_FILE.test(name))
      .some((name) => {
        const text = runtime.readText(planPath(paths.root, name));
        return text.ok && statusOf(text.value) === "accepted" && text.value.toLowerCase().includes(concept);
      });

export const scanChange = (runtime: ScanRuntime, t: Translate, paths: FmPaths, base: string): ScanResult => {
  const task = activeTask(runtime, paths);
  const goal = task?.contract.goal ?? "";
  const context = companyContext(readGoals(runtime, paths.root));
  const snap = diffSnapshot(runtime, paths, base);
  const weight = solutionWeight(
    {
      addedDeps: snap.addedDeps.map((item) => item.name),
      installedDeps: snap.installed.map((item) => item.name),
      addedFiles: snap.addedFiles,
      changedFiles: snap.changedFiles,
    },
    context.demonstrated.map((item) => item.value),
  );
  const contract = task === undefined ? undefined : runtime.readText(paths.task(task.contract.id));
  const proportion = weigh(
    weight,
    context,
    problemWeight(contract?.ok === true ? contract.value : ""),
    decidedConcept(runtime, paths),
  );
  const reuse = existingMatches(runtime, paths.root, snap).map((match) => ({
    feature: "guardian-reuse" as const,
    report: reuseReport(t, match, goal),
  }));
  const heavy =
    proportion.verdict === "report"
      ? [{ feature: "proportionality" as const, report: proportionReport(t, weight, context, proportion, goal) }]
      : [];
  return { weight, proportion, reports: [...reuse, ...heavy] };
};
