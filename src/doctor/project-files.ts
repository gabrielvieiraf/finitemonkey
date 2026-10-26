import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { type Check, type CheckFinding, type DoctorEnv, finding } from "./types.js";

interface FileGroup {
  readonly name: string;
  readonly files: readonly string[];
}

const variants = (base: string, extensions: readonly string[]): readonly string[] =>
  extensions.map((extension) => `${base}${extension}`);

const SCRIPT = [".js", ".cjs", ".mjs", ".ts", ".cts", ".mts"] as const;
const DATA = ["", ".json", ".yml", ".yaml"] as const;

export const LOCKFILE_GROUPS: readonly FileGroup[] = [
  {
    name: "JavaScript",
    files: ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"],
  },
  { name: "Python", files: ["poetry.lock", "uv.lock", "Pipfile.lock", "pdm.lock"] },
];

export const CONFIG_GROUPS: readonly FileGroup[] = [
  { name: "ESLint", files: [...variants("eslint.config", SCRIPT), ...variants(".eslintrc", [...DATA, ".js", ".cjs"])] },
  {
    name: "Prettier",
    files: [
      ...variants(".prettierrc", [...DATA, ".json5", ".toml", ".js", ".cjs", ".mjs"]),
      ...variants("prettier.config", SCRIPT),
    ],
  },
  {
    name: "Babel",
    files: [...variants(".babelrc", ["", ".json", ".js"]), ...variants("babel.config", [...SCRIPT, ".json"])],
  },
  { name: "Jest", files: [...variants("jest.config", SCRIPT), "jest.config.json"] },
  { name: "Vitest", files: variants("vitest.config", SCRIPT) },
  {
    name: "commitlint",
    files: [...variants("commitlint.config", SCRIPT), ...variants(".commitlintrc", [...DATA, ".js"])],
  },
];

const present = (env: DoctorEnv, files: readonly string[]): readonly string[] =>
  files.filter((file) => env.runtime.stat(toAbsolutePath(join(env.root, file)))?.kind === "file");

const crowded = (
  env: DoctorEnv,
  groups: readonly FileGroup[],
  build: (group: string, files: string) => CheckFinding,
): readonly CheckFinding[] =>
  groups.flatMap(({ name, files }) => {
    const found = present(env, files);
    return found.length > 1 ? [build(name, found.join(", "))] : [];
  });

export const checkProjectFiles: Check = (env) => [
  ...crowded(env, LOCKFILE_GROUPS, (ecosystem, files) =>
    finding(
      "project.lockfiles",
      "warn",
      "doctor.project.lockfiles",
      { ecosystem, files },
      "doctor.project.fix_lockfiles",
    ),
  ),
  ...crowded(env, CONFIG_GROUPS, (tool, files) =>
    finding("project.configs", "warn", "doctor.project.configs", { tool, files }, "doctor.project.fix_configs"),
  ),
];
