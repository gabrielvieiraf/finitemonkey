import { duplicatedConfigFindings } from "./config-dupes.js";
import { deepImportFindings } from "./deep-imports.js";
import type { DetectorSources } from "./detector-sources.js";
import { isQualityFile, type QualityLimits } from "./limits.js";
import { pythonFindings } from "./python-metrics.js";
import type { QualityFinding } from "./ratchet.js";
import { unusedDependencyFindings } from "./unused-deps.js";

export const DETECTORS_FEATURE = "quality-detectors";

export interface DetectorAnalysis {
  readonly findings: readonly QualityFinding[];
  readonly pythonSkipped: boolean;
}

export const analyzeDetectors = (sources: DetectorSources, limits: QualityLimits): DetectorAnalysis => {
  const touched = sources.changed.filter((file) => isQualityFile(file, limits));
  const python = pythonFindings(sources, touched, limits);
  return {
    findings: [
      ...deepImportFindings(sources, touched),
      ...unusedDependencyFindings(sources),
      ...duplicatedConfigFindings(sources),
      ...python.findings,
    ],
    pythonSkipped: python.skipped,
  };
};
