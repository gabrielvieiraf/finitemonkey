import { posix } from "node:path";

import { matchesAny } from "../core/glob.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "./paths.js";

export const SCOPE_CACHE = "scope.json";
export const FIRST_EDITS = 3;
export const TEST_GLOBS: readonly string[] = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
];

export interface InferredScope {
  readonly task: string;
  readonly dirs: readonly string[];
  readonly seen: number;
  readonly widened: boolean;
}

export type ScopeEvent = "learned" | "inside" | "widened" | "outside";

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const readInferred = (runtime: Pick<Runtime, "readText">, paths: FmPaths): InferredScope | undefined => {
  const text = runtime.readText(paths.cache(SCOPE_CACHE));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  if (parsed?.ok !== true || !isRecord(parsed.value)) return undefined;
  const { task, seen, widened } = parsed.value;
  if (typeof task !== "string") return undefined;
  return {
    task,
    dirs: strings(parsed.value["dirs"]),
    seen: typeof seen === "number" && Number.isInteger(seen) ? seen : 0,
    widened: widened === true,
  };
};

export const writeInferred = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, scope: InferredScope): void => {
  runtime.writeText(paths.cache(SCOPE_CACHE), `${JSON.stringify(scope)}\n`);
};

const dirOf = (file: string): string => posix.dirname(file);

const globOf = (dir: string): string => (dir === "." ? "*" : `${dir}/**`);

export const scopeGlobs = (scope: InferredScope): readonly string[] => [...scope.dirs.map(globOf), ...TEST_GLOBS];

export const inInferred = (scope: InferredScope, file: string): boolean => matchesAny(file, scopeGlobs(scope));

export const scopeLabel = (scope: InferredScope): string => scope.dirs.map(globOf).join(", ");

const withDir = (scope: InferredScope, file: string): readonly string[] =>
  scope.dirs.includes(dirOf(file)) ? scope.dirs : [...scope.dirs, dirOf(file)];

export const observeEdit = (
  before: InferredScope | undefined,
  task: string,
  file: string,
): { readonly scope: InferredScope; readonly event: ScopeEvent } => {
  const scope = before?.task === task ? before : { task, dirs: [], seen: 0, widened: false };
  if (matchesAny(file, TEST_GLOBS)) return { scope, event: "inside" };
  if (scope.seen < FIRST_EDITS) {
    return { scope: { ...scope, dirs: withDir(scope, file), seen: scope.seen + 1 }, event: "learned" };
  }
  if (inInferred(scope, file)) return { scope, event: "inside" };
  if (!scope.widened) return { scope: { ...scope, dirs: withDir(scope, file), widened: true }, event: "widened" };
  return { scope, event: "outside" };
};
