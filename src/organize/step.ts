import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { stringifyYaml } from "../core/yaml/write.js";
import { detectChecks } from "../task/implicit.js";
import { contractHash } from "../task/load.js";
import type { FmPaths } from "../task/paths.js";
import { contractYaml } from "../task/serialize.js";
import { readState, readTrust, writeState, writeTrust } from "../task/state.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import type { TaskContract } from "../task/types.js";

const TARGETS = "organize-targets.json";

export const stepId = (file: string, step: number): string =>
  `organize-${file.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`.slice(0, 56).concat(`-${String(step)}`);

export const stepContract = (runtime: Runtime, root: AbsolutePath, id: string, goal: string): TaskContract => {
  const files = {
    read: (relative: string) => {
      const text = runtime.readText(toAbsolutePath(join(root, relative)));
      return text.ok ? text.value : undefined;
    },
    exists: (relative: string) => runtime.stat(toAbsolutePath(join(root, relative))) !== undefined,
  };
  return {
    id,
    goal,
    size: "M",
    scope: { paths: [], testsProtected: true },
    acceptance: [...detectChecks(files), { id: "callers", kind: "callers" }, { id: "organize", kind: "organize" }],
    decisionsNeeded: [],
    implicit: false,
  };
};

export const saveStep = (runtime: Runtime, paths: FmPaths, contract: TaskContract): boolean => {
  if (runtime.stat(paths.task(contract.id)) !== undefined) return false;
  const text = stringifyYaml(contractYaml(contract));
  if (!runtime.writeText(paths.task(contract.id), text).ok) return false;
  const lock = readTrust(runtime, paths);
  writeTrust(runtime, paths, {
    ...lock,
    contracts: { ...lock.contracts, [contract.id]: contractHash(contract) },
    approved: { ...lock.approved, [contract.id]: text },
  });
  writeState(runtime, paths, { ...readState(runtime, paths), active: contract.id });
  return true;
};

export const openTargets = (runtime: Runtime, paths: FmPaths): readonly string[] => {
  const raw = readJsonFile(runtime, paths.cache(TARGETS));
  const list = isRecord(raw) ? raw["open"] : undefined;
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
};

export const writeTargets = (runtime: Runtime, paths: FmPaths, open: readonly string[]): void => {
  writeJsonFile(runtime, paths.cache(TARGETS), { open: [...open] });
};
