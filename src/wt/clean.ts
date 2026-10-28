import { basename } from "node:path";

import { accept, type Parsed } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import { archiveWorktree } from "./archive.js";
import { type Classified, type CleanupClass, NEVER_REMOVED } from "./classify.js";
import type { WorktreeStatus } from "./entry.js";
import { classifyAll, type Inventory } from "./inventory.js";
import { reap } from "./reap.js";
import { patchEntry } from "./store.js";

export const CLEAN_ACTIONS = ["remove", "archive-remove", "prune", "archive-keep", "keep"] as const;

export type CleanAction = (typeof CLEAN_ACTIONS)[number];

export const DEFAULT_INCLUDE: readonly CleanupClass[] = ["contained", "equivalent", "orphan"];

export interface PlanItem {
  readonly id: string;
  readonly path: string;
  readonly branch: string | null;
  readonly cls: CleanupClass;
  readonly action: CleanAction;
  readonly dirty: readonly string[];
  readonly pids: readonly number[];
}

export interface AppliedItem extends PlanItem {
  readonly done: boolean;
  readonly detail: string;
  readonly archive: string | null;
}

export interface CleanOptions {
  readonly include: readonly CleanupClass[];
  readonly archiveContained: boolean;
}

const actionFor = (cls: CleanupClass, options: CleanOptions): CleanAction => {
  if (cls === "unpushed") return "archive-keep";
  if (NEVER_REMOVED.has(cls) || !options.include.includes(cls)) return "keep";
  if (cls === "contained") return options.archiveContained ? "archive-remove" : "remove";
  if (cls === "equivalent") return "archive-remove";
  return cls === "orphan" ? "prune" : "keep";
};

export const planItem = (item: Classified, options: CleanOptions): PlanItem => ({
  id: item.entry?.id ?? basename(item.path),
  path: toPosixPath(item.path),
  branch: item.branch,
  cls: item.cls,
  action: actionFor(item.cls, options),
  dirty: item.dirty,
  pids: item.pids,
});

export const cleanPlan = (inventory: Inventory, options: CleanOptions): readonly PlanItem[] =>
  classifyAll(inventory).map((item) => planItem(item, options));

const statusAfter: Readonly<Record<CleanAction, WorktreeStatus | undefined>> = {
  remove: "removed",
  "archive-remove": "archived",
  prune: "removed",
  "archive-keep": undefined,
  keep: undefined,
};

const recordStatus = (inventory: Inventory, item: AppliedItem): void => {
  const status = statusAfter[item.action];
  if (!item.done || (status === undefined && item.archive === null)) return;
  patchEntry(inventory.context.runtime, inventory.commonDir, item.path, {
    ...(status === undefined ? {} : { status }),
    ...(item.archive === null ? {} : { archive: item.archive }),
  });
};

const runAction = (inventory: Inventory, item: PlanItem): Omit<AppliedItem, keyof PlanItem> => {
  const { runtime } = inventory.context;
  const { mainRoot } = inventory;
  if (item.action === "remove") {
    const removed = runtime.gitWith(["worktree", "remove", item.path], mainRoot, {});
    if (!removed.ok) return { done: false, detail: removed.stderr.trim(), archive: null };
    const deleted = item.branch === null ? undefined : runtime.gitWith(["branch", "-d", item.branch], mainRoot, {});
    return { done: true, detail: deleted?.ok === false ? deleted.stderr.trim() : "", archive: null };
  }
  if (item.action === "prune") {
    const pruned = runtime.gitWith(["worktree", "prune"], mainRoot, {});
    return { done: pruned.ok, detail: pruned.stderr.trim(), archive: null };
  }
  if (item.action === "keep") return { done: false, detail: "", archive: null };
  const archived = archiveWorktree(runtime, {
    path: item.path,
    id: item.id,
    branch: item.branch,
    mainRoot,
    remove: item.action === "archive-remove",
    deleteBranch: item.action === "archive-remove",
    generated: inventory.context.generated,
  });
  return archived.ok
    ? { done: true, detail: "", archive: archived.value.ref }
    : { done: false, detail: archived.error, archive: null };
};

export const applyClean = (
  inventory: Inventory,
  options: CleanOptions,
  reapRunning: boolean,
): Parsed<readonly AppliedItem[]> => {
  const items = classifyAll(inventory);
  if (reapRunning) {
    const running = items.filter((item) => item.cls === "running");
    if (running.length > 0) {
      reap(
        inventory.context.runtime,
        running.flatMap((item) => item.pids),
      );
      const refreshed = {
        ...inventory,
        context: { ...inventory.context, processes: inventory.context.runtime.processes() },
      };
      return applyClean(refreshed, options, false);
    }
  }
  return accept(
    items.map((item) => {
      const planned = planItem(item, options);
      const applied: AppliedItem = { ...planned, ...runAction(inventory, planned) };
      recordStatus(inventory, applied);
      return applied;
    }),
  );
};
