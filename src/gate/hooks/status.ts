import type { Runtime } from "../../core/runtime.js";
import type { FmPaths } from "../../task/paths.js";
import { readJsonFile, writeJsonFile } from "../../task/state.js";

export const STATUS_FILE = "gate-status.json";

export type GateStatusKind = "passed" | "failed" | "incomplete" | "not_run" | "not_done";

export interface GateStatus {
  readonly status: GateStatusKind;
  readonly task: string;
  readonly detail: string;
  readonly at: string;
}

const KINDS: readonly GateStatusKind[] = ["passed", "failed", "incomplete", "not_run", "not_done"];

export const writeGateStatus = (
  runtime: Pick<Runtime, "writeText" | "now">,
  paths: FmPaths,
  status: Omit<GateStatus, "at">,
): boolean => writeJsonFile(runtime, paths.cache(STATUS_FILE), { ...status, at: runtime.now() }).ok;

export const readGateStatus = (runtime: Pick<Runtime, "readText">, paths: FmPaths): GateStatus | undefined => {
  const raw = readJsonFile(runtime, paths.cache(STATUS_FILE));
  const status = KINDS.find((kind) => kind === raw?.["status"]);
  const task = raw?.["task"];
  const detail = raw?.["detail"];
  const at = raw?.["at"];
  if (status === undefined || typeof task !== "string" || typeof detail !== "string" || typeof at !== "string")
    return undefined;
  return { status, task, detail, at };
};
