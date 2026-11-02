import { logEvent } from "../../evidence/log.js";
import type { Note } from "../../evidence/types.js";
import { recordFeatureShadow } from "../../policy/feature.js";
import { analyzeQuality } from "../../quality/analyze.js";
import { analyzeDetectors, type DetectorAnalysis, DETECTORS_FEATURE } from "../../quality/detectors.js";
import { detectorSources } from "../../quality/gate-detectors.js";
import { guardMode, qualitySources } from "../../quality/gate-sources.js";
import { loadLimits, QUALITY_GUARD, type QualityLimits } from "../../quality/limits.js";
import { blocking, type QualityFinding } from "../../quality/ratchet.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";

const MAX_LISTED = 15;

const findingNote = (finding: QualityFinding): Note =>
  note(`gate.quality.${finding.rule}`, { file: finding.file, line: finding.line, ...finding.params });

const countsByRule = (findings: readonly QualityFinding[]): Readonly<Record<string, number>> => {
  const counts: Record<string, number> = {};
  for (const finding of findings) counts[finding.rule] = (counts[finding.rule] ?? 0) + 1;
  return counts;
};

const activeDetectors = (ctx: GateContext, limits: QualityLimits): DetectorAnalysis | undefined => {
  const mode = guardMode(ctx, DETECTORS_FEATURE);
  if (mode === "off") return undefined;
  const analysis = analyzeDetectors(detectorSources(ctx), limits);
  if (mode === "active") return analysis;
  if (analysis.findings.length === 0 && !analysis.pythonSkipped) return undefined;
  recordFeatureShadow(ctx.runtime, ctx.paths, DETECTORS_FEATURE, {
    task: ctx.contract.id,
    rules: countsByRule(analysis.findings),
    pythonSkipped: analysis.pythonSkipped,
  });
  return undefined;
};

export const qualityCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = guardMode(ctx, QUALITY_GUARD);
  if (mode === "off") return passed([note("gate.quality.off")]);
  const limits = loadLimits(ctx.runtime, ctx.paths.root);
  const analysis = analyzeQuality(qualitySources(ctx), limits);
  const detectors = activeDetectors(ctx, limits);
  const findings = [...analysis.findings, ...(detectors?.findings ?? [])];
  const blocks = blocking(findings);
  const ordered = [...blocks, ...findings.filter((finding) => finding.level === "warn")];
  if (findings.length > 0) {
    logEvent(ctx.runtime, ctx.paths, "quality.findings", {
      task: ctx.contract.id,
      mode,
      block: blocks.length,
      warn: findings.length - blocks.length,
      rules: countsByRule(findings),
    });
  }
  const notes = [
    ...ordered.slice(0, MAX_LISTED).map(findingNote),
    ...(analysis.metricsSkipped ? [note("gate.quality.no_typescript")] : []),
    ...(detectors?.pythonSkipped === true ? [note("gate.quality.no_python")] : []),
  ];
  if (blocks.length === 0) return passed([note("gate.quality.clean", { count: analysis.files }), ...notes]);
  if (mode === "shadow") return passed([note("gate.quality.shadow", { count: blocks.length }), ...notes]);
  return failed([...notes, note("gate.quality.fix")]);
};
