import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { commonDirOf, registryDir } from "../wt/store.js";

export interface FoundReport {
  readonly json: JsonObject;
  readonly markdownPath: AbsolutePath;
}

const REVIEWER = /^@?([A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)?)$/;

const readReport = (runtime: Runtime, path: AbsolutePath): JsonObject | undefined => {
  const text = runtime.readText(path);
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  return parsed?.ok === true ? parsed.value : undefined;
};

const branchOf = (report: JsonObject): unknown =>
  isRecord(report["integration"]) ? report["integration"]["branch"] : undefined;

export const latestMergeReport = (runtime: Runtime, root: AbsolutePath, branch: string): FoundReport | undefined => {
  const common = commonDirOf(runtime, root);
  if (common === undefined) return undefined;
  const dir = toAbsolutePath(join(registryDir(common), "merges"));
  const names = runtime.listDir(dir);
  const reports = (names.ok ? names.value : [])
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse();
  for (const name of reports) {
    const json = readReport(runtime, toAbsolutePath(join(dir, name)));
    if (json !== undefined && branchOf(json) === branch) {
      return { json, markdownPath: toAbsolutePath(join(dir, name.replace(/\.json$/, ".md"))) };
    }
  }
  return undefined;
};

export const mergeSummary = (runtime: Runtime, report: FoundReport | undefined): string | undefined => {
  const summary = report === undefined ? undefined : runtime.readText(report.markdownPath);
  return summary?.ok === true ? summary.value.trim() : undefined;
};

const ownersOf = (file: unknown): readonly string[] => {
  if (!isRecord(file) || file["class"] !== "C0" || !Array.isArray(file["owners"])) return [];
  return file["owners"].filter((owner): owner is string => typeof owner === "string");
};

export const reviewersOf = (report: FoundReport | undefined): readonly string[] => {
  const files = report?.json["files"];
  const owners = Array.isArray(files) ? files.flatMap(ownersOf) : [];
  return [...new Set(owners.flatMap((owner) => REVIEWER.exec(owner)?.[1] ?? []))];
};
