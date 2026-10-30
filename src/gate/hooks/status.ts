import type { Runtime } from "../../core/runtime.js";
import { COMPLETION_STATES, type CompletionState } from "../../evidence/types.js";
import type { FmPaths } from "../../task/paths.js";
import { readJsonFile, writeJsonFile } from "../../task/state.js";

export const STATUS_FILE = "gate-status.json";

export type GateStatusKind = "passed" | "failed" | "incomplete" | "not_run" | "not_done" | "released_by_cap";

export interface GateStatus {
  readonly status: GateStatusKind;
  readonly task: string;
  readonly detail: string;
  readonly at: string;
  readonly state?: CompletionState;
  readonly tree?: string;
}

const KINDS: readonly GateStatusKind[] = ["passed", "failed", "incomplete", "not_run", "not_done", "released_by_cap"];

export const UNPROVEN: ReadonlySet<GateStatusKind> = new Set(["not_run", "released_by_cap"]);

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
  const state = COMPLETION_STATES.find((item) => item === raw?.["state"]);
  const tree = raw?.["tree"];
  if (status === undefined || typeof task !== "string" || typeof detail !== "string" || typeof at !== "string")
    return undefined;
  return {
    status,
    task,
    detail,
    at,
    ...(state === undefined ? {} : { state }),
    ...(typeof tree === "string" ? { tree } : {}),
  };
};

export const recordReleasedByCap = (
  runtime: Pick<Runtime, "writeText" | "now">,
  paths: FmPaths,
  task: string,
  detail: string,
): boolean => writeGateStatus(runtime, paths, { status: "released_by_cap", task, detail });
