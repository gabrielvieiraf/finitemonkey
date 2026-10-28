import { newClones } from "./clones.js";
import { newCycles } from "./cycles.js";
import { isQualityFile, type QualityLimits } from "./limits.js";
import { fileMetrics } from "./metrics.js";
import { compareFile, type QualityFinding } from "./ratchet.js";
import { isTsFamily, type TsApi } from "./ts-api.js";

export interface QualitySources {
  readonly changed: readonly string[];
  readonly before: (file: string) => string | undefined;
  readonly after: (file: string) => string | undefined;
  readonly exists: (file: string) => boolean;
  readonly consumed: (name: string, file: string) => boolean;
  readonly ts: TsApi | undefined;
}

export interface QualityAnalysis {
  readonly files: number;
  readonly findings: readonly QualityFinding[];
  readonly metricsSkipped: boolean;
}

interface Touched {
  readonly file: string;
  readonly before: string | undefined;
  readonly after: string;
}

const MAX_EXPORTS = 30;

const unusedExports = (sources: QualitySources, touched: readonly Touched[]): readonly QualityFinding[] => {
  const fresh = touched.flatMap((item) => {
    if (!isTsFamily(item.file)) return [];
    const old = new Set(item.before === undefined ? [] : fileMetrics(sources.ts, item.file, item.before).exports);
    return fileMetrics(sources.ts, item.file, item.after)
      .exports.filter((name) => !old.has(name))
      .map((name) => ({ file: item.file, name }));
  });
  return fresh
    .slice(0, MAX_EXPORTS)
    .filter(({ file, name }) => !sources.consumed(name, file))
    .map(({ file, name }) => ({ rule: "unused_export", level: "warn", file, line: 1, params: { name } }));
};

export const analyzeQuality = (sources: QualitySources, limits: QualityLimits): QualityAnalysis => {
  const touched = sources.changed
    .filter((file) => isQualityFile(file, limits))
    .flatMap((file): Touched[] => {
      const after = sources.after(file);
      return after === undefined ? [] : [{ file, before: sources.before(file), after }];
    });
  const metrics = touched.flatMap((item) => {
    const ts = isTsFamily(item.file) ? sources.ts : undefined;
    const before = item.before === undefined ? undefined : fileMetrics(ts, item.file, item.before);
    return compareFile(item.file, before, fileMetrics(ts, item.file, item.after), limits);
  });
  const clones = newClones(touched, limits.cloneLines).map((clone): QualityFinding => ({
    rule: "clone",
    level: "block",
    file: clone.file,
    line: clone.line,
    params: { other: `${clone.otherFile}:${String(clone.otherLine)}`, lines: clone.lines },
  }));
  const cycles = newCycles(touched, { read: sources.after, exists: sources.exists }).map((cycle): QualityFinding => ({
    rule: "import_cycle",
    level: "block",
    file: cycle.file,
    line: 1,
    params: { path: cycle.path.join(" -> ") },
  }));
  return {
    files: touched.length,
    findings: [...metrics, ...clones, ...cycles, ...(sources.ts === undefined ? [] : unusedExports(sources, touched))],
    metricsSkipped: sources.ts === undefined && touched.some((item) => isTsFamily(item.file)),
  };
};
