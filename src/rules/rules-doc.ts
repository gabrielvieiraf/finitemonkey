import type { AbsolutePath } from "../core/brand.js";
import { DATA_DIR } from "../core/data-dir.js";
import type { Runtime } from "../core/runtime.js";
import { buildDerived, DERIVED_FEATURE } from "../knowledge/derived.js";
import { featureMode } from "../policy/feature.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import { fmPaths } from "../task/paths.js";
import { ruleLine } from "./outputs.js";
import type { ProjectRule } from "./types.js";

export const RULES_DOC = "AGENTS.rules.md";
export const RULES_DOC_MARK = "<!-- finitemonkey:generated from .fm/rules.yml; edit rules.yml, not this file -->";
export const RULES_GENERATOR = {
  file: RULES_DOC,
  generator: "rules",
  sources: [`${DATA_DIR}/rules.yml`] as readonly string[],
};
export const RULES_INCLUDE = `@${RULES_DOC}`;

export type DocRuntime = Pick<
  Runtime,
  "readText" | "writeText" | "mkdir" | "appendText" | "now" | "homeDir" | "remove"
>;

export const rulesDocText = (rules: readonly Pick<ProjectRule, "id" | "text">[]): string =>
  [RULES_DOC_MARK, "", ...rules.map(ruleLine), ""].join("\n");

export const rulesAsDoc = (runtime: Pick<Runtime, "readText" | "homeDir">, root: AbsolutePath): boolean =>
  featureMode(runtime, fmPaths(root), DERIVED_FEATURE) !== "off";

export interface DocWrite {
  readonly built: boolean;
  readonly edited: readonly string[];
}

export const writeRulesDoc = (runtime: DocRuntime, root: AbsolutePath, rules: readonly ProjectRule[]): DocWrite => {
  const text = rulesDocText(rules);
  const result = buildDerived(runtime, fmPaths(root), {
    ...RULES_GENERATOR,
    inputs: { rules: sha256Hex(text).slice(0, 16) },
    render: () => text,
  });
  return result.kind === "built" ? { built: true, edited: result.edited } : { built: false, edited: [] };
};
