import type { JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import type { FmPaths } from "../task/paths.js";
import { modeOf, readShadow } from "./guards.js";
import { type GuardMode, loadPolicy } from "./policy.js";

export const featureMode = (runtime: Pick<Runtime, "readText">, paths: FmPaths, id: string): GuardMode =>
  modeOf({ id, damage: false }, loadPolicy(runtime, paths.root), readShadow(runtime, paths));

export const recordFeatureShadow = (
  runtime: Pick<Runtime, "appendText" | "now">,
  paths: FmPaths,
  id: string,
  data: JsonObject,
): void => {
  logEvent(runtime, paths, "feature_shadow", { feature: id, ...data });
};
