import { basename, dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, type Parsed } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { WorktreeEntry, WorktreeOwner } from "./entry.js";
import { activityOf, type GitWorktree, gitWorktrees } from "./git-list.js";
import { isWithinPath } from "./place.js";
import { commonDirOf, readRegistry, type Registry, updateRegistry } from "./store.js";

export const UNKNOWN_OWNER: WorktreeOwner = { kind: "unknown", agentId: null, sessionId: null };

const sameTree = (left: string, right: string): boolean => isWithinPath(left, right) && isWithinPath(right, left);

const freeId = (taken: ReadonlySet<string>, wanted: string): string => {
  const clean = wanted.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || "worktree";
  if (!taken.has(clean)) return clean;
  let suffix = 2;
  while (taken.has(`${clean}-${String(suffix)}`)) suffix += 1;
  return `${clean}-${String(suffix)}`;
};

export const adoptable = (registry: Registry, trees: readonly GitWorktree[]): readonly GitWorktree[] =>
  trees.filter(
    (tree) => !tree.main && !tree.bare && !registry.worktrees.some((item) => sameTree(item.path, tree.path)),
  );

const entryFor = (runtime: Runtime, tree: GitWorktree, id: string, owner: WorktreeOwner): WorktreeEntry => {
  const now = runtime.now();
  return {
    id,
    path: tree.path,
    branch: tree.branch,
    baseRef: null,
    baseSha: null,
    target: null,
    owner,
    purpose: "",
    contract: null,
    parent: null,
    ports: null,
    pids: [],
    createdAt: now,
    activityAt: activityOf(runtime, tree) ?? now,
    status: "adopted",
    pr: null,
    archive: null,
  };
};

export const adoptInto = (
  runtime: Runtime,
  registry: Registry,
  trees: readonly GitWorktree[],
  owner: WorktreeOwner,
): { readonly registry: Registry; readonly adopted: readonly WorktreeEntry[] } => {
  const taken = new Set(registry.worktrees.map((item) => item.id));
  const adopted = adoptable(registry, trees).map((tree) => {
    const id = freeId(taken, basename(tree.path));
    taken.add(id);
    return entryFor(runtime, tree, id, owner);
  });
  return adopted.length === 0
    ? { registry, adopted }
    : { registry: { worktrees: [...registry.worktrees, ...adopted] }, adopted };
};

const MAX_DEPTH = 64;

export const mayHaveLinkedWorktrees = (runtime: Runtime, cwd: AbsolutePath): boolean => {
  let dir: string = cwd;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const dotGit = runtime.stat(toAbsolutePath(join(dir, ".git")));
    if (dotGit !== undefined) {
      if (dotGit.kind !== "dir") return true;
      return runtime.stat(toAbsolutePath(join(dir, ".git", "worktrees"))) !== undefined;
    }
    const parent = dirname(dir);
    if (parent === dir) return true;
    dir = parent;
  }
  return true;
};

export const adoptWorktrees = (
  runtime: Runtime,
  cwd: AbsolutePath,
  owner: WorktreeOwner = UNKNOWN_OWNER,
): Parsed<readonly WorktreeEntry[]> => {
  if (!mayHaveLinkedWorktrees(runtime, cwd)) return accept([]);
  const commonDir = commonDirOf(runtime, cwd);
  const trees = gitWorktrees(runtime, cwd);
  if (commonDir === undefined || trees === undefined) return accept([]);
  const seen = readRegistry(runtime, commonDir);
  if (seen.ok && adoptable(seen.value, trees).length === 0) return accept([]);
  return updateRegistry(runtime, commonDir, owner.agentId ?? owner.sessionId ?? "finitemonkey", (registry) => {
    const next = adoptInto(runtime, registry, trees, owner);
    return accept({ registry: next.registry, result: next.adopted });
  });
};
