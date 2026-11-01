import { projectPaths } from "../gate/hooks/common.js";
import type { HookInput } from "../hooks/handlers.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import type { FmPaths } from "../task/paths.js";

export const ATTENTION_FEATURE = "attention";

export const usable = (input: HookInput): FmPaths | undefined => {
  const paths = projectPaths(input);
  return paths !== undefined && input.runtime.stat(paths.dir)?.kind === "dir" ? paths : undefined;
};

export const attentionActive = (input: HookInput, paths: FmPaths, kind: string): boolean => {
  if (featureMode(input.runtime, paths, ATTENTION_FEATURE) === "active") return true;
  recordFeatureShadow(input.runtime, paths, ATTENTION_FEATURE, { kind });
  return false;
};
