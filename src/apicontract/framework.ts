import { isRecord, parseJsonObject } from "../core/parsed.js";

export const FRAMEWORKS = ["vite", "next", "remix"] as const;
export type Framework = (typeof FRAMEWORKS)[number];
export type TestRunner = "vitest" | "jest" | "node";

export interface Project {
  readonly framework: Framework | undefined;
  readonly base: string;
  readonly runner: TestRunner;
}

const dependencies = (packageJson: string | undefined): ReadonlySet<string> => {
  const parsed = packageJson === undefined ? undefined : parseJsonObject(packageJson);
  if (parsed?.ok !== true) return new Set();
  return new Set(
    ["dependencies", "devDependencies"].flatMap((key) => {
      const section = parsed.value[key];
      return isRecord(section) ? Object.keys(section) : [];
    }),
  );
};

const frameworkOf = (deps: ReadonlySet<string>): Framework | undefined => {
  if (deps.has("next")) return "next";
  if ([...deps].some((name) => name.startsWith("@remix-run/")) || deps.has("@react-router/dev")) return "remix";
  return deps.has("vite") ? "vite" : undefined;
};

export const detectProject = (
  read: (relative: string) => string | undefined,
  exists: (relative: string) => boolean,
): Project => {
  const deps = dependencies(read("package.json"));
  const framework = frameworkOf(deps);
  const base = framework === "remix" ? "app" : framework === "next" && !exists("src") ? "lib" : "src";
  const runner: TestRunner = deps.has("vitest") ? "vitest" : deps.has("jest") ? "jest" : "node";
  return { framework, base, runner };
};
