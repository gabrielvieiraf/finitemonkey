import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { readGateStatus } from "../gate/hooks/status.js";
import { HOOK_FAILURE_EVENT } from "../hooks/failure-log.js";
import type { FmPaths } from "../task/paths.js";

export type GateLight = "green" | "red" | "incomplete" | "did_not_run" | "none";

const GATE_HOOKS = new Set(["Stop", "SubagentStop"]);
const TAIL_BYTES = 64 * 1024;

const lastGateFailure = (runtime: Pick<Runtime, "readText">, paths: FmPaths): string | undefined => {
  const log = runtime.readText(paths.log);
  if (!log.ok) return undefined;
  const lines = log.value.slice(-TAIL_BYTES).split("\n").reverse();
  for (const line of lines) {
    if (!line.includes(HOOK_FAILURE_EVENT)) continue;
    const parsed = parseJsonObject(line);
    if (!parsed.ok || !isRecord(parsed.value)) continue;
    const { event, hook, at } = parsed.value;
    if (event === HOOK_FAILURE_EVENT && typeof hook === "string" && GATE_HOOKS.has(hook) && typeof at === "string")
      return at;
  }
  return undefined;
};

export const gateLight = (runtime: Pick<Runtime, "readText">, paths: FmPaths): GateLight => {
  const status = readGateStatus(runtime, paths);
  const failure = lastGateFailure(runtime, paths);
  const greenSince = status?.status === "passed" ? Date.parse(status.at) : Number.NEGATIVE_INFINITY;
  if (failure !== undefined && Date.parse(failure) >= greenSince) return "did_not_run";
  if (status === undefined) return "none";
  switch (status.status) {
    case "passed":
      return "green";
    case "failed":
    case "not_done":
      return "red";
    case "incomplete":
      return "incomplete";
    case "not_run":
      return "did_not_run";
  }
};
