import type { AbsolutePath } from "../core/brand.js";
import { baseOf, dirOf, projectFiles, type SupplyRuntime } from "./files.js";

export const COOLDOWN_DAYS = 7;
export const DEPENDABOT_FILE = ".github/dependabot.yml";
export const RENOVATE_FILE = "renovate.json";

export type UpdateTool = "dependabot" | "renovate";

const MANIFESTS: Readonly<Record<string, string>> = {
  "package.json": "npm",
  "pyproject.toml": "pip",
  "requirements.txt": "pip",
  Pipfile: "pip",
};

export interface UpdateEcosystem {
  readonly ecosystem: string;
  readonly directories: readonly string[];
}

const add = (map: Map<string, Set<string>>, ecosystem: string, dir: string): void => {
  const set = map.get(ecosystem) ?? new Set<string>();
  set.add(`/${dir}`);
  map.set(ecosystem, set);
};

export const updateEcosystems = (files: readonly string[]): readonly UpdateEcosystem[] => {
  const map = new Map<string, Set<string>>();
  const uvDirs = new Set(files.filter((file) => baseOf(file) === "uv.lock").map(dirOf));
  for (const file of files) {
    if (file.split("/").includes("node_modules")) continue;
    const manifest = MANIFESTS[baseOf(file)];
    if (manifest !== undefined) add(map, manifest === "pip" && uvDirs.has(dirOf(file)) ? "uv" : manifest, dirOf(file));
    if (/^Dockerfile(?:\..+)?$/.test(baseOf(file))) add(map, "docker", dirOf(file));
    if (file.startsWith(".github/workflows/")) add(map, "github-actions", "");
  }
  return [...map.entries()]
    .map(([ecosystem, dirs]) => ({ ecosystem, directories: [...dirs].sort() }))
    .sort((left, right) => left.ecosystem.localeCompare(right.ecosystem));
};

const dependabotEntry = (entry: UpdateEcosystem): readonly string[] => [
  `  - package-ecosystem: ${entry.ecosystem}`,
  "    directories:",
  ...entry.directories.map((dir) => `      - "${dir}"`),
  "    schedule:",
  "      interval: weekly",
  "    cooldown:",
  `      default-days: ${String(COOLDOWN_DAYS)}`,
  "    groups:",
  "      minor-and-patch:",
  "        update-types:",
  "          - minor",
  "          - patch",
];

export const dependabotConfig = (ecosystems: readonly UpdateEcosystem[]): string =>
  ["version: 2", "updates:", ...ecosystems.flatMap(dependabotEntry), ""].join("\n");

export const renovateConfig = (): string =>
  `${JSON.stringify(
    {
      $schema: "https://docs.renovatebot.com/renovate-schema.json",
      extends: ["config:recommended"],
      minimumReleaseAge: `${String(COOLDOWN_DAYS)} days`,
      internalChecksFilter: "strict",
      packageRules: [{ matchUpdateTypes: ["minor", "patch"], groupName: "minor and patch updates" }],
    },
    null,
    2,
  )}\n`;

export const updateConfig = (
  runtime: SupplyRuntime,
  root: AbsolutePath,
  tool: UpdateTool,
): { readonly file: string; readonly text: string; readonly ecosystems: readonly UpdateEcosystem[] } => {
  const ecosystems = updateEcosystems(projectFiles(runtime, root));
  return tool === "renovate"
    ? { file: RENOVATE_FILE, text: renovateConfig(), ecosystems }
    : { file: DEPENDABOT_FILE, text: dependabotConfig(ecosystems), ecosystems };
};
