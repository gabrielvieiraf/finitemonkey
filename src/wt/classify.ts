import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { ProcessInfo, Runtime } from "../core/runtime.js";
import { parsePorcelainV2 } from "../git/facts.js";
import { integrationTargets, isContained, isEquivalent, isUnpushed } from "./branch-state.js";
import type { WorktreeEntry } from "./entry.js";
import { isGeneratedPath } from "./generated.js";
import type { GitWorktree } from "./git-list.js";
import { activityOf } from "./git-list.js";
import { isWithinPath } from "./place.js";

export const CLEANUP_CLASSES = [
  "orphan",
  "dirty",
  "locked",
  "running",
  "recent",
  "contained",
  "equivalent",
  "unpushed",
  "open",
] as const;

export type CleanupClass = (typeof CLEANUP_CLASSES)[number];

export const NEVER_REMOVED: ReadonlySet<CleanupClass> = new Set(["dirty", "locked", "running", "recent", "unpushed"]);

export interface ClassifyContext {
  readonly runtime: Runtime;
  readonly mainRoot: AbsolutePath;
  readonly defaultBranch: string;
  readonly staleDays: number;
  readonly processes: readonly ProcessInfo[];
  readonly generated: readonly string[];
}

export interface Classified {
  readonly path: string;
  readonly entry: WorktreeEntry | undefined;
  readonly tree: GitWorktree | undefined;
  readonly branch: string | null;
  readonly tip: string | null;
  readonly cls: CleanupClass;
  readonly dirty: readonly string[];
  readonly pids: readonly number[];
  readonly activityAt: string | null;
}

const DAY_MS = 86_400_000;

export const dirtyFiles = (runtime: Runtime, path: AbsolutePath, generated: readonly string[]): readonly string[] => {
  const status = runtime.gitWith(["status", "--porcelain=v2", "-z", "--untracked-files=all"], path, {
    env: { GIT_OPTIONAL_LOCKS: "0" },
  });
  if (!status.ok) return ["(git status failed)"];
  return parsePorcelainV2(status.stdout)
    .map((entry) => entry.path)
    .filter((file) => !isGeneratedPath(file, generated));
};

export const pidsInside = (
  context: Pick<ClassifyContext, "runtime" | "processes">,
  path: string,
): readonly number[] => {
  const real = context.runtime.realpath(path);
  return context.processes
    .filter((info) => isWithinPath(path, info.cwd) || isWithinPath(real, info.cwd))
    .map((info) => info.pid);
};

const isRecent = (context: ClassifyContext, activityAt: string | null): boolean => {
  if (activityAt === null) return false;
  const age = Date.parse(context.runtime.now()) - Date.parse(activityAt);
  return Number.isFinite(age) && age < context.staleDays * DAY_MS;
};

interface Facts {
  readonly exists: boolean;
  readonly dirty: readonly string[];
  readonly pids: readonly number[];
  readonly activityAt: string | null;
  readonly tip: string | null;
}

const branchClass = (context: ClassifyContext, tip: string | null, target: string | null): CleanupClass => {
  if (tip === null) return "open";
  const { runtime, mainRoot } = context;
  const targets = integrationTargets(runtime, mainRoot, context.defaultBranch, [target]);
  if (isContained(runtime, mainRoot, tip, targets)) return "contained";
  if (isEquivalent(runtime, mainRoot, tip, targets)) return "equivalent";
  return isUnpushed(runtime, mainRoot, tip) ? "unpushed" : "open";
};

const classOf = (context: ClassifyContext, facts: Facts, tree: GitWorktree | undefined, entry?: WorktreeEntry) => {
  if (!facts.exists || tree === undefined || tree.prunable) return "orphan";
  if (facts.dirty.length > 0) return "dirty";
  if (tree.locked !== null) return "locked";
  if (facts.pids.length > 0) return "running";
  if (isRecent(context, facts.activityAt)) return "recent";
  return branchClass(context, facts.tip, entry?.target ?? null);
};

export const classify = (
  context: ClassifyContext,
  tree: GitWorktree | undefined,
  entry: WorktreeEntry | undefined,
): Classified => {
  const path = tree?.path ?? entry?.path ?? "";
  const dir = toAbsolutePath(path);
  const exists = context.runtime.stat(dir)?.kind === "dir";
  const live = exists && tree !== undefined && !tree.prunable;
  const facts: Facts = {
    exists,
    dirty: live ? dirtyFiles(context.runtime, dir, context.generated) : [],
    pids: live ? pidsInside(context, path) : [],
    activityAt: tree === undefined ? (entry?.activityAt ?? null) : (activityOf(context.runtime, tree) ?? null),
    tip: tree?.head ?? null,
  };
  return {
    path,
    entry,
    tree,
    branch: tree?.branch ?? entry?.branch ?? null,
    tip: facts.tip,
    cls: classOf(context, facts, tree, entry),
    dirty: facts.dirty,
    pids: facts.pids,
    activityAt: facts.activityAt,
  };
};
