import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { ONBOARD_FILE, parseOnboard } from "../onboard/state.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { ONBOARD_START_FEATURE } from "../policy/merge-guards.js";
import type { FmPaths } from "../task/paths.js";
import type { AcceptanceCheck } from "../task/types.js";

type Files = Pick<Runtime, "readText" | "homeDir" | "appendText" | "now">;

export const onboardStart = (runtime: Pick<Runtime, "readText">, paths: FmPaths): string | undefined => {
  const text = runtime.readText(toAbsolutePath(join(paths.root, ONBOARD_FILE)));
  return text.ok ? parseOnboard(text.value)?.start : undefined;
};

export const withOnboardStart = (runtime: Files, paths: FmPaths, check: AcceptanceCheck): AcceptanceCheck => {
  if (check.run !== undefined) return check;
  const start = onboardStart(runtime, paths);
  if (start === undefined) return check;
  const mode = featureMode(runtime, paths, ONBOARD_START_FEATURE);
  if (mode === "shadow") recordFeatureShadow(runtime, paths, ONBOARD_START_FEATURE, { check: check.id, start });
  return mode === "active" ? { ...check, run: start } : check;
};
