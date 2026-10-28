import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, type Parsed } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { defaultOn } from "../defaults/items.js";
import { ATTRIBUTION_OFF } from "../install/settings-merge.js";
import { MANIFEST_FILE } from "./manifest.js";
import { EMPTY_SCOPE, loadRules, type ProjectRule } from "./types.js";

export const NO_ATTRIBUTION: ProjectRule = {
  id: "no-attribution",
  text: "No AI attribution in commits or pull requests: no Co-Authored-By for AI tools, no Generated with footer, no robot emoji",
  origin: "finitemonkey default",
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
  const missing =
    defaultOn(runtime, root, "no-attribution") && !declared.value.some((rule) => rule.id === NO_ATTRIBUTION.id);
  return accept(missing ? [...declared.value, NO_ATTRIBUTION] : declared.value);
};

export const coverageRules = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
): Parsed<readonly ProjectRule[]> =>
  runtime.readText(toAbsolutePath(MANIFEST_FILE, root)).ok
    ? effectiveRules(runtime, root)
    : loadRules(runtime, root, PRESET_RULES);
