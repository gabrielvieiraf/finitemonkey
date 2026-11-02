import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { ConventionId } from "./conventions.js";

export interface DetectedConvention {
  readonly id: ConventionId;
  readonly value: string;
  readonly evidence: string;
}

export interface RepoFiles {
  readonly read: (relative: string) => string | undefined;
  readonly exists: (relative: string) => boolean;
  readonly isDir: (relative: string) => boolean;
}

const RUNNERS = ["vitest", "jest", "mocha", "ava"] as const;
const ESLINT_FILES = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yml",
];
const LINTERS: readonly (readonly [string, readonly string[]])[] = [
  ["eslint", ESLINT_FILES],
  ["biome", ["biome.json", "biome.jsonc"]],
  ["ruff", ["ruff.toml", ".ruff.toml"]],
];
const LAYOUTS = ["src", "app", "lib"] as const;

const manifest = (files: RepoFiles): JsonObject | undefined => {
  const text = files.read("package.json");
  const parsed = text === undefined ? undefined : parseJsonObject(text);
  return parsed?.ok === true ? parsed.value : undefined;
};

const sectionHas = (pkg: JsonObject | undefined, name: string): boolean =>
  ["dependencies", "devDependencies"].some((key) => {
    const section = pkg?.[key];
    return isRecord(section) && section[name] !== undefined;
  });

const testRunner = (files: RepoFiles): DetectedConvention | undefined => {
  const pkg = manifest(files);
  const runner = RUNNERS.find((name) => sectionHas(pkg, name));
  if (runner !== undefined) return { id: "tests", value: runner, evidence: `package.json (${runner})` };
  const scripts = pkg?.["scripts"];
  const test = isRecord(scripts) ? scripts["test"] : undefined;
  if (typeof test === "string" && /\bnode\b.*--test\b/.test(test))
    return { id: "tests", value: "node", evidence: "package.json (scripts.test)" };
  const pytest = ["pytest.ini", "conftest.py"].find((file) => files.exists(file));
  return pytest === undefined ? undefined : { id: "tests", value: "pytest", evidence: pytest };
};

const linter = (files: RepoFiles): DetectedConvention | undefined => {
  for (const [value, candidates] of LINTERS) {
    const found = candidates.find((file) => files.exists(file));
    if (found !== undefined) return { id: "lint", value, evidence: found };
  }
  return undefined;
};

const layout = (files: RepoFiles): DetectedConvention | undefined => {
  const dir = LAYOUTS.find((name) => files.isDir(name));
  return dir === undefined ? undefined : { id: "layout", value: dir, evidence: `${dir}/` };
};

export const detectConventions = (files: RepoFiles): readonly DetectedConvention[] =>
  [testRunner(files), linter(files), layout(files)].flatMap((item) => (item === undefined ? [] : [item]));
