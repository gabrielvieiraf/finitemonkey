import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { matchesAny } from "../core/glob.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml } from "../core/yaml/parse.js";
import type { MergeSide } from "./hunk.js";

export interface SideScope {
  readonly paths: readonly string[];
  readonly append: readonly string[];
  readonly generated: readonly string[];
  readonly inferred: boolean;
}

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const scopeFromContract = (runtime: Runtime, path: AbsolutePath): SideScope | undefined => {
  const text = runtime.readText(path);
  if (!text.ok) return undefined;
  const parsed = parseYaml(text.value);
  if (!parsed.ok || !isRecord(parsed.value)) return undefined;
  const scope = isRecord(parsed.value["scope"]) ? parsed.value["scope"] : {};
  const shared = isRecord(scope["shared"]) ? scope["shared"] : {};
  return {
    paths: strings(scope["paths"]),
    append: strings(shared["append"]),
    generated: [...strings(scope["generated"]), ...strings(parsed.value["generated"])],
    inferred: false,
  };
};

export const inferredScope = (files: readonly string[]): SideScope => ({
  paths: files,
  append: [],
  generated: [],
  inferred: true,
});

export const loadScope = (
  runtime: Runtime,
  cwd: AbsolutePath,
  contract: string | undefined,
  diffFiles: readonly string[],
): SideScope =>
  (contract === undefined ? undefined : scopeFromContract(runtime, toAbsolutePath(contract, cwd))) ??
  inferredScope(diffFiles);

export interface Scopes {
  readonly ours: SideScope;
  readonly theirs: SideScope;
}

const inScope = (scope: SideScope, path: string): boolean =>
  scope.paths.includes(path) || matchesAny(path, scope.paths) || matchesAny(path, scope.append);

export const outOfScope = (scopes: Scopes, path: string): boolean =>
  !scopes.ours.inferred && !scopes.theirs.inferred && !inScope(scopes.ours, path) && !inScope(scopes.theirs, path);

export const ownerOf = (scopes: Scopes, path: string): MergeSide | undefined => {
  if (scopes.ours.inferred || scopes.theirs.inferred) return undefined;
  const ours = matchesAny(path, scopes.ours.paths);
  const theirs = matchesAny(path, scopes.theirs.paths);
  if (ours === theirs) return undefined;
  return ours ? "ours" : "theirs";
};

export const isAppendOnly = (scopes: Scopes, path: string): boolean =>
  matchesAny(path, scopes.ours.append) || matchesAny(path, scopes.theirs.append);

export const isDeclaredGenerated = (scopes: Scopes, path: string): boolean =>
  matchesAny(path, scopes.ours.generated) || matchesAny(path, scopes.theirs.generated);
