import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, type Parsed } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { CONFIG_FILE } from "../install/layout.js";
import { ATTRIBUTION_OFF } from "../install/settings-merge.js";
import { presetFromConfig } from "../prose/preset.js";
import { EMPTY_SCOPE, loadRules, type ProjectRule } from "./types.js";

export const NO_ATTRIBUTION: ProjectRule = {
  id: "no-attribution",
  text: "No AI attribution in commits or pull requests: no Co-Authored-By for AI tools, no Generated with footer, no robot emoji",
  origin: "finitemonkey preset",
  severity: "never",
  detector: { kind: "attribution" },
  settings: { attribution: { ...ATTRIBUTION_OFF } },
  bucket: "deterministic",
  scope: EMPTY_SCOPE,
  why: undefined,
};

export const PRESET_RULES: Readonly<Record<string, ProjectRule>> = { attribution: NO_ATTRIBUTION };

export const effectiveRules = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
): Parsed<readonly ProjectRule[]> => {
  const declared = loadRules(runtime, root, PRESET_RULES);
  if (!declared.ok) return declared;
  const config = runtime.readText(toAbsolutePath(CONFIG_FILE, root));
  const strict = config.ok && presetFromConfig(config.value) !== "neutral";
  const missing = strict && !declared.value.some((rule) => rule.id === NO_ATTRIBUTION.id);
  return accept(missing ? [...declared.value, NO_ATTRIBUTION] : declared.value);
};
