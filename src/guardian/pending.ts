import { isRecord, type JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { contextOutput, projectPaths } from "../gate/hooks/common.js";
import type { HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, readState, writeJsonFile } from "../task/state.js";
import { appendDecision } from "./decisions.js";
import { onceFor } from "./once.js";
import { parseReport, renderReport, showable } from "./report.js";
import type { ScanReport } from "./scan.js";

const FILE = "guardian-pending.json";
const SCAN_FILE = "guardian-scan.json";
export const SCAN_EVERY_MS = 10 * 60_000;

const scanDue = (runtime: Pick<Runtime, "readText" | "writeText" | "now">, paths: FmPaths): boolean => {
  const last = readJsonFile(runtime, paths.cache(SCAN_FILE))?.["startedAt"];
  const now = Date.parse(runtime.now());
  if (typeof last === "string" && now - Date.parse(last) < SCAN_EVERY_MS) return false;
  writeJsonFile(runtime, paths.cache(SCAN_FILE), { startedAt: runtime.now() });
  return true;
};

export const readPending = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly JsonObject[] => {
  const raw = readJsonFile(runtime, paths.cache(FILE))?.["reports"];
  return Array.isArray(raw) ? raw.filter(isRecord) : [];
};

const writePending = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, reports: readonly JsonObject[]): void => {
  writeJsonFile(runtime, paths.cache(FILE), { reports: [...reports] });
};

export const recordScan = (
  runtime: Pick<Runtime, "readText" | "writeText" | "appendText" | "now" | "homeDir">,
  paths: FmPaths,
  reports: readonly ScanReport[],
): number => {
  const fresh = reports.filter((item) => {
    const mode = featureMode(runtime, paths, item.feature);
    if (mode === "off") return false;
    const signature = sha256Hex(`${item.feature}\u0000${item.report.evidence.join("\u0000")}`);
    if (!onceFor(runtime, paths, "guardian-scanned.json", signature)) return false;
    if (mode === "shadow") recordFeatureShadow(runtime, paths, item.feature, { trigger: item.report.trigger });
    return mode === "active";
  });
  if (fresh.length > 0)
    writePending(runtime, paths, [
      ...readPending(runtime, paths),
      ...fresh.map((item) => ({ feature: item.feature, report: { ...item.report } })),
    ]);
  return fresh.length;
};

export const scanStop =
  (feature: string): HookHandler =>
  (input) => {
    const paths = projectPaths(input);
    if (paths === undefined || readState(input.runtime, paths).active === undefined) return { kind: "allow" };
    if (featureMode(input.runtime, paths, feature) === "off" || !scanDue(input.runtime, paths))
      return { kind: "allow" };
    input.runtime.spawnSelf(["guardian", "scan", "--record"], paths.root);
    return { kind: "allow" };
  };

const shown = (input: HookInput, paths: FmPaths, feature: string): readonly string[] => {
  const pending = readPending(input.runtime, paths);
  const mine = pending.filter((item) => item["feature"] === feature);
  if (mine.length === 0) return [];
  writePending(
    input.runtime,
    paths,
    pending.filter((item) => item["feature"] !== feature),
  );
  return mine.flatMap((item) => {
    const report = parseReport(item["report"]);
    if (report === undefined || !showable(report)) return [];
    appendDecision(input.runtime, paths, {
      source: "report",
      at: input.runtime.now(),
      subject: report.request,
      recommendation: report.recommendation,
      evidence: report.evidence,
      decision: "pending",
      paths: report.paths,
      trigger: report.trigger,
    });
    return [renderReport(input.t, report)];
  });
};

export const pendingPrompt =
  (feature: string): HookHandler =>
  (input) => {
    const paths = projectPaths(input);
    if (paths === undefined || featureMode(input.runtime, paths, feature) !== "active") return { kind: "allow" };
    const lines = shown(input, paths, feature);
    return lines.length === 0
      ? { kind: "allow" }
      : {
          kind: "allow",
          output: contextOutput("UserPromptSubmit", [input.t("guardian.pending.intro"), ...lines].join("\n\n")),
        };
  };

export const scanHandlers = (feature: string): HookHandlers => ({
  Stop: [scanStop(feature)],
  UserPromptSubmit: [pendingPrompt(feature)],
});
