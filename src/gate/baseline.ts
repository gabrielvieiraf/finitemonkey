import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import type { Baseline, BaselineEntry } from "./types.js";

export const BASELINE_FILE = "baseline.json";
export const SESSION_FILE = "session.json";

export interface SessionMark {
  readonly sessionId: string;
  readonly startTree: string;
  readonly at: number;
  readonly findings?: number;
}

export const readSession = (runtime: Pick<Runtime, "readText">, paths: FmPaths): SessionMark | undefined => {
  const raw = readJsonFile(runtime, paths.cache(SESSION_FILE));
  const sessionId = raw?.["sessionId"];
  const startTree = raw?.["startTree"];
  const at = raw?.["at"];
  const findings = raw?.["findings"];
  if (typeof sessionId !== "string" || typeof startTree !== "string" || typeof at !== "number") return undefined;
  return { sessionId, startTree, at, ...(typeof findings === "number" ? { findings } : {}) };
};

export const writeSession = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, mark: SessionMark): boolean =>
  writeJsonFile(runtime, paths.cache(SESSION_FILE), { ...mark }).ok;

const entry = (value: unknown): BaselineEntry | undefined => {
  if (!isRecord(value)) return undefined;
  const exitCode = value["exitCode"];
  const failures = value["failures"];
  if (!(typeof exitCode === "number" || exitCode === null) || !Array.isArray(failures)) return undefined;
  return { exitCode, failures: failures.filter((item): item is string => typeof item === "string") };
};

export const readBaseline = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
): { readonly treeHash: string; readonly checks: Baseline } | undefined => {
  const raw = readJsonFile(runtime, paths.cache(BASELINE_FILE));
  const treeHash = raw?.["treeHash"];
  const checks = raw?.["checks"];
  if (typeof treeHash !== "string" || !isRecord(checks)) return undefined;
  const parsed = Object.entries(checks).flatMap(([id, value]) => {
    const item = entry(value);
    return item === undefined ? [] : [[id, item] as const];
  });
  return { treeHash, checks: Object.fromEntries(parsed) };
};

export const writeBaseline = (
  runtime: Pick<Runtime, "writeText">,
  paths: FmPaths,
  treeHash: string,
  checks: Baseline,
): boolean => writeJsonFile(runtime, paths.cache(BASELINE_FILE), { treeHash, checks: { ...checks } }).ok;
