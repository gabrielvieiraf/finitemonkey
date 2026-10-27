import type { AbsolutePath } from "../core/brand.js";
import { baseOf, dirOf, projectFiles, type SupplyRuntime } from "./files.js";

export type LockEcosystem = "javascript" | "python";

const LOCKFILES: Readonly<Record<string, LockEcosystem>> = {
  "package-lock.json": "javascript",
  "npm-shrinkwrap.json": "javascript",
  "yarn.lock": "javascript",
  "pnpm-lock.yaml": "javascript",
  "bun.lockb": "javascript",
  "bun.lock": "javascript",
  "poetry.lock": "python",
  "uv.lock": "python",
  "Pipfile.lock": "python",
  "pdm.lock": "python",
};

export interface LockConflict {
  readonly dir: string;
  readonly ecosystem: LockEcosystem;
  readonly files: readonly string[];
}

export const lockConflictsIn = (files: readonly string[]): readonly LockConflict[] => {
  const groups = new Map<string, { dir: string; ecosystem: LockEcosystem; files: string[] }>();
  for (const file of files) {
    const ecosystem = LOCKFILES[baseOf(file)];
    if (ecosystem === undefined || file.split("/").includes("node_modules")) continue;
    const key = `${dirOf(file)}\u0000${ecosystem}`;
    const group = groups.get(key) ?? { dir: dirOf(file), ecosystem, files: [] };
    group.files.push(file);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.files.length > 1)
    .map((group) => ({ ...group, files: [...group.files].sort() }));
};

export const lockConflicts = (runtime: SupplyRuntime, root: AbsolutePath): readonly LockConflict[] =>
  lockConflictsIn(projectFiles(runtime, root));
