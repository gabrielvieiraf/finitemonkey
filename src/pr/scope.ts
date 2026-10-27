import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { matchesAny } from "../core/glob.js";
import { toPosixPath } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";
import { scopeFromContract, type SideScope } from "../merge/scope.js";
import { fmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import { entryFor } from "../wt/inventory.js";
import { commonDirOf, readRegistry } from "../wt/store.js";

export interface ChangedFile {
  readonly status: string;
  readonly path: string;
}

export interface ScopeCheck {
  readonly contract: string | undefined;
  readonly declared: readonly string[];
  readonly inside: readonly ChangedFile[];
  readonly outside: readonly ChangedFile[];
}

export const changedSince = (runtime: Runtime, root: AbsolutePath, base: string): readonly ChangedFile[] => {
  const result = runtime.git(["diff", "--name-status", "-M", "-z", `${base}..HEAD`], root);
  if (!result.ok) return [];
  const fields = result.stdout.split("\u0000").filter((field) => field !== "");
  const files: ChangedFile[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const status = fields[index] ?? "";
    const renamed = status.startsWith("R") || status.startsWith("C");
    const path = fields[index + (renamed ? 2 : 1)] ?? "";
    files.push({ status: status.slice(0, 1), path });
    index += renamed ? 2 : 1;
  }
  return files;
};

const registryContract = (runtime: Runtime, root: AbsolutePath): string | undefined => {
  const common = commonDirOf(runtime, root);
  if (common === undefined) return undefined;
  const registry = readRegistry(runtime, common);
  return registry.ok ? (entryFor(registry.value, root)?.contract ?? undefined) : undefined;
};

export const contractFor = (runtime: Runtime, root: AbsolutePath, explicit: string | undefined): string | undefined => {
  if (explicit !== undefined) return explicit;
  const fromRegistry = registryContract(runtime, root);
  if (fromRegistry !== undefined) return fromRegistry;
  const active = readState(runtime, fmPaths(root)).active;
  return active === undefined ? undefined : toPosixPath(join(".finitemonkey", "tasks", `${active}.yml`));
};

const declaredOf = (scope: SideScope | undefined): readonly string[] =>
  scope === undefined ? [] : [...scope.paths, ...scope.append, ...scope.generated];

export const checkScope = (
  runtime: Runtime,
  root: AbsolutePath,
  files: readonly ChangedFile[],
  explicit: string | undefined,
): ScopeCheck => {
  const contract = contractFor(runtime, root, explicit);
  const scope = contract === undefined ? undefined : scopeFromContract(runtime, toAbsolutePath(contract, root));
  const declared = declaredOf(scope);
  const outside = declared.length === 0 ? [] : files.filter((file) => !matchesAny(file.path, declared));
  return {
    contract: scope === undefined ? undefined : contract,
    declared,
    inside: files.filter((file) => !outside.includes(file)),
    outside,
  };
};
