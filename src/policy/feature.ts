import type { JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import type { FmPaths } from "../task/paths.js";
import { experimentArm } from "./experiment.js";
import { modeOf, readShadow } from "./guards.js";
import { type GuardMode, loadPolicy } from "./policy.js";

export const featureMode = (runtime: Pick<Runtime, "readText" | "homeDir">, paths: FmPaths, id: string): GuardMode => {
  const policy = loadPolicy(runtime, paths.root);
  return modeOf({ id, damage: false }, policy, readShadow(runtime, paths), experimentArm(runtime, paths, policy, id));
};

export const recordFeatureShadow = (
  runtime: Pick<Runtime, "appendText" | "now">,
  paths: FmPaths,
  id: string,
  data: JsonObject,
): void => {
  logEvent(runtime, paths, "feature_shadow", { feature: id, ...data });
};
