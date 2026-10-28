import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { toPosixPath } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";
import { type CoverageProblem, coverageProblems, mockRoutes } from "./coverage.js";
import { MOCK_DIRS } from "./generate.js";
import { type ApiRegistry, CONTRACT_FILE, parseRegistry } from "./registry.js";

export type LoadedRegistry =
  | { readonly kind: "absent" }
  | { readonly kind: "invalid"; readonly issues: readonly string[] }
  | { readonly kind: "ok"; readonly registry: ApiRegistry };

export const loadRegistry = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): LoadedRegistry => {
  const raw = runtime.readText(toAbsolutePath(join(root, CONTRACT_FILE)));
  if (!raw.ok) return { kind: "absent" };
  const parsed = parseRegistry(raw.value);
  return parsed.ok ? { kind: "ok", registry: parsed.value } : { kind: "invalid", issues: parsed.error };
};

const SOURCE = /\.[cm]?[jt]sx?$/;

const mockSources = (runtime: Pick<Runtime, "readText" | "walkFiles">, root: AbsolutePath) =>
  MOCK_DIRS.flatMap((dir) => {
    const base = toAbsolutePath(join(root, dir));
    const files = runtime.walkFiles(base);
    if (!files.ok) return [];
    return files.value.flatMap((file) => {
      const absolute = toAbsolutePath(file, base);
      const text = SOURCE.test(file) ? runtime.readText(absolute) : undefined;
      const relative = toPosixPath(absolute).slice(toPosixPath(root).length + 1);
      return text?.ok === true ? [{ path: relative, text: text.value }] : [];
    });
  });

export const contractCoverage = (
  runtime: Pick<Runtime, "readText" | "walkFiles">,
  root: AbsolutePath,
  registry: ApiRegistry,
): readonly CoverageProblem[] => coverageProblems(registry, mockRoutes(mockSources(runtime, root)));
