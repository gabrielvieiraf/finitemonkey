import { isRecord, parseJsonObject } from "../../core/parsed.js";
import { toPosixPath } from "../../core/posix-path.js";
import { sha256Hex as sha256 } from "../../secrets/fingerprint.js";
import { isProtectedConfig, isSnapshot, testLanguage } from "./patterns.js";
import { countTests } from "./scan.js";

export const TEST_VIOLATIONS = [
  "test_file_deleted",
  "test_removed",
  "skip_added",
  "assertion_removed",
  "snapshot_changed",
  "config_changed",
  "out_of_scope",
] as const;

export type TestViolationKind = (typeof TEST_VIOLATIONS)[number];

export interface TestViolation {
  readonly kind: TestViolationKind;
  readonly path: string;
  readonly before?: number;
  readonly after?: number;
}

const PACKAGE_KEYS = [
  "jest",
  "vitest",
  "eslintConfig",
  "prettier",
  "c8",
  "nyc",
  "ava",
  "mocha",
  "husky",
  "lint-staged",
];
const PACKAGE_SCRIPTS = /^(test|lint|typecheck|check|format|pretest|precommit|prepare)(:.*)?$/;
const PYPROJECT_SECTION = /^\[tool\.(pytest|coverage|ruff|mypy|pylint|black|isort)/;

const packageDigest = (content: string): string => {
  const parsed = parseJsonObject(content);
  if (!parsed.ok) return sha256(content);
  const scripts = parsed.value["scripts"];
  const picked = {
    keys: PACKAGE_KEYS.map((key) => [key, parsed.value[key] ?? null]),
    scripts: isRecord(scripts) ? Object.entries(scripts).filter(([name]) => PACKAGE_SCRIPTS.test(name)) : [],
  };
  return sha256(JSON.stringify(picked));
};

const pyprojectDigest = (content: string): string => {
  let inTool = false;
  const kept = content.split("\n").filter((line) => {
    if (line.trimStart().startsWith("[")) inTool = PYPROJECT_SECTION.test(line.trim());
    return inTool;
  });
  return sha256(kept.join("\n"));
};

export const configDigest = (path: string, content: string | undefined): string | undefined => {
  if (!isProtectedConfig(path)) return undefined;
  if (content === undefined) return "absent";
  const name = toPosixPath(path).split("/").pop() ?? "";
  if (name === "package.json") return packageDigest(content);
  if (name === "pyproject.toml") return pyprojectDigest(content);
  return sha256(content);
};

export const compareTestFile = (
  path: string,
  before: string | undefined,
  after: string | undefined,
): readonly TestViolation[] => {
  if (before === undefined) return [];
  if (isSnapshot(path)) return before === after ? [] : [{ kind: "snapshot_changed", path }];
  const language = testLanguage(path);
  if (language === undefined) return [];
  if (after === undefined) return [{ kind: "test_file_deleted", path }];
  const old = countTests(language, before);
  const now = countTests(language, after);
  const found: TestViolation[] = [];
  if (now.tests < old.tests) found.push({ kind: "test_removed", path, before: old.tests, after: now.tests });
  if (now.skips > old.skips) found.push({ kind: "skip_added", path, before: old.skips, after: now.skips });
  if (now.assertions < old.assertions) {
    found.push({ kind: "assertion_removed", path, before: old.assertions, after: now.assertions });
  }
  return found;
};

export const compareNewTestFile = (path: string, after: string): readonly TestViolation[] => {
  const language = testLanguage(path);
  if (language === undefined) return [];
  const counts = countTests(language, after);
  return counts.skips > 0 ? [{ kind: "skip_added", path, before: 0, after: counts.skips }] : [];
};

export const compareConfig = (
  path: string,
  before: string | undefined,
  after: string | undefined,
  accepted: string | undefined,
): readonly TestViolation[] => {
  const old = configDigest(path, before);
  const now = configDigest(path, after);
  if (before === undefined || old === undefined || now === undefined || old === now || now === accepted) return [];
  return [{ kind: "config_changed", path }];
};
