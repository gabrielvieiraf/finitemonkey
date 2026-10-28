import type { JsonObject } from "../core/parsed.js";
import type { CompiledRule, Surface } from "./manifest.js";
import type { ProjectRule } from "./types.js";

const FILE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"] as const;

export const applicableSurfaces = (rule: ProjectRule): readonly Surface[] => {
  const detector = rule.detector;
  const settings: readonly Surface[] = rule.settings === undefined ? [] : ["config"];
  const never: readonly Surface[] = rule.severity === "never" ? ["ci"] : [];
  if (detector === undefined) return [...settings];
  const bySurface: readonly Surface[] = (() => {
    switch (detector.kind) {
      case "command":
        return ["guard", "config", ...never];
      case "path":
        return ["guard", "config", "ci"];
      case "text":
        return ["guard", ...(detector.on.includes("commit") ? (["git"] as const) : []), "ci"];
      case "lint":
        return ["ci"];
      case "check":
        return ["guard", "ci"];
    }
  })();
  return [...new Set([...bySurface, ...settings])];
};

export const denyEntries = (rule: ProjectRule): readonly string[] => {
  const detector = rule.detector;
  if (detector?.kind === "command") return [`Bash(${detector.command}:*)`];
  if (detector?.kind === "path")
    return detector.tools
      .filter((tool) => FILE_TOOLS.some((known) => known === tool))
      .map((tool) => `${tool}(${detector.path})`);
  return [];
};

export const compiledRule = (rule: ProjectRule, ci: boolean): CompiledRule => {
  const surfaces = applicableSurfaces(rule).filter((surface) => surface !== "ci" || ci);
  const settings: JsonObject = rule.settings ?? {};
  return { surfaces: [...surfaces, "text"], deny: denyEntries(rule), settings };
};
