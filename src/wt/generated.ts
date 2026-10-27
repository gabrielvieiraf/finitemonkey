import { toPosixPath } from "../core/posix-path.js";

export const GENERATED_DIRS = [
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "__pycache__",
  ".venv",
  "test-results",
  "playwright-report",
] as const;

const GENERATED_SUFFIXES = [".tsbuildinfo"] as const;

export const isGeneratedPath = (path: string, extra: readonly string[] = []): boolean => {
  const parts = toPosixPath(path).split("/");
  const dirs: readonly string[] = [...GENERATED_DIRS, ...extra];
  return parts.some((part) => dirs.includes(part)) || GENERATED_SUFFIXES.some((suffix) => path.endsWith(suffix));
};
