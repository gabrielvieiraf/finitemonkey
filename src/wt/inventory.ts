import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, configList, loadProjectConfig } from "../git/project-config.js";
import { openRepo, repoFacts } from "../git/repo.js";
import { type Classified, classify, type ClassifyContext } from "./classify.js";
import type { WorktreeEntry } from "./entry.js";
import { type GitWorktree, gitWorktrees } from "./git-list.js";
import { isWithinPath } from "./place.js";
import { commonDirOf, readRegistry, type Registry } from "./store.js";

export const DEFAULT_STALE_DAYS = 7;

export interface Inventory {
  readonly mainRoot: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly registry: Registry;
  readonly registryError: string | undefined;
  readonly trees: readonly GitWorktree[];
  readonly context: ClassifyContext;
}

const samePath = (left: string, right: string): boolean => isWithinPath(left, right) && isWithinPath(right, left);

const numberAt = (raw: unknown, fallback: number): number => {
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

export const loadInventory = (
  runtime: Runtime,
  cwd: AbsolutePath,
  staleDays: number | undefined,
): Inventory | undefined => {
  const trees = gitWorktrees(runtime, cwd);
  const commonDir = commonDirOf(runtime, cwd);
  const main = trees?.find((tree) => tree.main);
  if (trees === undefined || commonDir === undefined || main === undefined) return undefined;
  const mainRoot = toAbsolutePath(main.path);
  const repo = openRepo(runtime, mainRoot);
  const config = loadProjectConfig(runtime, mainRoot);
  const read = readRegistry(runtime, commonDir);
  return {
    mainRoot,
    commonDir,
    registry: read.ok ? read.value : { worktrees: [] },
    registryError: read.ok ? undefined : read.error,
    trees,
    context: {
      runtime,
      mainRoot,
      defaultBranch: repo === undefined ? "main" : repoFacts(runtime, repo, config).defaultBranch(),
      staleDays: staleDays ?? numberAt(configAt(config, "wt", "stale_days"), DEFAULT_STALE_DAYS),
      processes: runtime.processes(),
      generated: configList(config, "wt", "generated"),
    },
  };
};

export const entryFor = (registry: Registry, path: string): WorktreeEntry | undefined =>
  registry.worktrees.find((entry) => samePath(entry.path, path));

export const classifyAll = (inventory: Inventory): readonly Classified[] => {
  const linked = inventory.trees.filter((tree) => !tree.main && !tree.bare);
  const fromGit = linked.map((tree) => classify(inventory.context, tree, entryFor(inventory.registry, tree.path)));
  const stray = inventory.registry.worktrees.filter(
    (entry) =>
      !["removed", "archived"].includes(entry.status) && !linked.some((tree) => samePath(tree.path, entry.path)),
  );
  return [...fromGit, ...stray.map((entry) => classify(inventory.context, undefined, entry))];
};

export const findWorktree = (items: readonly Classified[], wanted: string, cwd: AbsolutePath): Classified | undefined =>
  items.find(
    (item) =>
      item.entry?.id === wanted ||
      item.branch === wanted ||
      samePath(item.path, wanted) ||
      samePath(item.path, toAbsolutePath(wanted, cwd)),
  );
