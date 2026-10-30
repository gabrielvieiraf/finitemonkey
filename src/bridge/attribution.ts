import type { Runtime } from "../core/runtime.js";
import { readGateStatus } from "../gate/hooks/status.js";
import { featureMode } from "../policy/feature.js";
import { effectiveRules } from "../rules/preset.js";
import type { FmPaths } from "../task/paths.js";

export const MOD_TRAILER_GUARD = "attribution-trailer";

export interface ModAttribution {
  readonly forbid: boolean;
  readonly trailer: string | null;
}

export const attributionOf = (runtime: Runtime, paths: FmPaths): ModAttribution => {
  const rules = effectiveRules(runtime, paths.root);
  const forbid = rules.ok && rules.value.some((rule) => rule.detector?.kind === "attribution");
  const gate = readGateStatus(runtime, paths);
  const trailer =
    featureMode(runtime, paths, MOD_TRAILER_GUARD) === "active" && gate?.tree !== undefined
      ? `Verified-by: finitemonkey ${gate.status} tree:${gate.tree}`
      : null;
  return { forbid, trailer };
};
