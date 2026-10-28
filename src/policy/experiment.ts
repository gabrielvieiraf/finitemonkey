import { createHash } from "node:crypto";

import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import type { FmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import type { Policy } from "./policy.js";

export type Arm = "active" | "off";

export const EXPERIMENT_ARM_EVENT = "experiment_arm";

export const armOf = (task: string, feature: string): Arm =>
  (createHash("sha256").update(`${task}\u0000${feature}`).digest()[0] ?? 0) % 2 === 0 ? "active" : "off";

export const experimentArm = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  policy: Policy,
  feature: string,
): Arm | undefined => {
  if (policy.experiments[feature] !== "random") return undefined;
  const task = readState(runtime, paths).active;
  return task === undefined ? undefined : armOf(task, feature);
};

export const recordArms = (
  runtime: Pick<Runtime, "appendText" | "now">,
  paths: FmPaths,
  policy: Policy,
  task: string,
): void => {
  for (const feature of Object.keys(policy.experiments)) {
    logEvent(runtime, paths, EXPERIMENT_ARM_EVENT, { feature, task, arm: armOf(task, feature) });
  }
};
