import { toPosixPath } from "../../core/posix-path.js";
export type TestLanguage = "js" | "py" | "go";

const JS_TEST = /(^|\/)(__tests__|__test__)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)tests?\/.*\.[cm]?[jt]sx?$/;
const PY_TEST = /(^|\/)test_[^/]*\.py$|_test\.py$|(^|\/)tests\/.*\.py$/;
const SNAPSHOT = /\.snap$|(^|\/)__snapshots__\//;

export const testLanguage = (path: string): TestLanguage | undefined => {
  const normalized = toPosixPath(path);
  if (normalized.endsWith("_test.go")) return "go";
  if (PY_TEST.test(normalized)) return "py";
  if (JS_TEST.test(normalized)) return "js";
  return undefined;
};

export const isSnapshot = (path: string): boolean => SNAPSHOT.test(toPosixPath(path));

export const isTestFile = (path: string): boolean => testLanguage(path) !== undefined || isSnapshot(path);

const CONFIG_NAMES = [
  /^(jest|vitest|vitest\.workspace|playwright|cypress|ava|stylelint|prettier|eslint)\.config\.[cm]?[jt]s$/,
  /^karma\.conf\.[cm]?js$/,
  /^\.(mocharc|nycrc|c8rc|eslintrc|prettierrc|stylelintrc)(\.[a-z]+)?$/,
  /^\.(eslintignore|prettierignore|coveragerc|flake8|pylintrc|ruff\.toml)$/,
  /^(pytest\.ini|tox\.ini|mypy\.ini|setup\.cfg|ruff\.toml|biome\.jsonc?|\.golangci\.ya?ml|lefthook\.ya?ml)$/,
  /^\.pre-commit-config\.ya?ml$/,
  /^tsconfig(\.[\w-]+)?\.json$/,
];

const HOOK_DIRS = /(^|\/)\.husky\//;

export const isProtectedConfig = (path: string): boolean => {
  const normalized = toPosixPath(path);
  if (HOOK_DIRS.test(normalized)) return true;
  const name = normalized.split("/").pop() ?? "";
  return name === "package.json" || name === "pyproject.toml" || CONFIG_NAMES.some((pattern) => pattern.test(name));
};
