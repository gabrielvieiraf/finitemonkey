import type { GeneratedFile } from "../generate/plan.js";
import type { ArchConfig } from "./config.js";
import { boundaries, dependencyCruiser, restrictedImports } from "./generate-js.js";
import { archUnit, depguard, importLinter } from "./generate-other.js";
import type { DenyMessage } from "./pairs.js";

export const ARCH_TOOLS = [
  "eslint",
  "boundaries",
  "dependency-cruiser",
  "import-linter",
  "archunit",
  "depguard",
] as const;

export type ArchTool = (typeof ARCH_TOOLS)[number];

export interface ProjectProbe {
  readonly exists: (relative: string) => boolean;
  readonly goModule: string | undefined;
}

export const isArchTool = (value: string): value is ArchTool => ARCH_TOOLS.some((tool) => tool === value);

export const detectArchTools = (probe: ProjectProbe): readonly ArchTool[] => {
  const any = (...files: readonly string[]): boolean => files.some(probe.exists);
  return [
    ...(any("package.json") ? (["eslint", "boundaries", "dependency-cruiser"] as const) : []),
    ...(any("pyproject.toml", "setup.py", "setup.cfg") ? (["import-linter"] as const) : []),
    ...(any("pom.xml", "build.gradle", "build.gradle.kts") ? (["archunit"] as const) : []),
    ...(any("go.mod") ? (["depguard"] as const) : []),
  ];
};

const isKotlin = (probe: ProjectProbe): boolean => probe.exists("build.gradle.kts") || probe.exists("src/main/kotlin");

export const archFiles = (
  config: ArchConfig,
  tools: readonly ArchTool[],
  deny: DenyMessage,
  probe: ProjectProbe,
): readonly GeneratedFile[] =>
  tools.map((tool) => {
    switch (tool) {
      case "eslint":
        return restrictedImports(config, deny);
      case "boundaries":
        return boundaries(config, deny);
      case "dependency-cruiser":
        return dependencyCruiser(config, deny);
      case "import-linter":
        return importLinter(config, deny);
      case "archunit":
        return archUnit(config, deny, isKotlin(probe));
      case "depguard":
        return depguard(config, deny, probe.goModule ?? "example.com/project");
    }
  });
