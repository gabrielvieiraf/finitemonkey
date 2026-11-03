import type { Runtime } from "../core/runtime.js";
import { readLedger } from "../evidence/ledger.js";
import { GATE_CHECK } from "../evidence/types.js";
import { featureMode } from "../policy/feature.js";
import { STATUSLINE_LOOP_FEATURE } from "../policy/merge-guards.js";
import type { FmPaths } from "../task/paths.js";

export const loopIndex = (
  runtime: Pick<Runtime, "readText" | "homeDir">,
  paths: FmPaths,
  task: string | undefined,
): number | undefined => {
  if (task === undefined || featureMode(runtime, paths, STATUSLINE_LOOP_FEATURE) !== "active") return undefined;
  const gates = readLedger(runtime, paths.evidence(task)).filter((entry) => entry.check === GATE_CHECK);
  const passed = gates.findLastIndex((entry) => entry.status === "passed");
  const loop = gates.length - passed - 1;
  return loop > 0 ? loop : undefined;
};
