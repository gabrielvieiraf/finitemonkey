import { accept, type Parsed, reject } from "../core/parsed.js";
import { type ApplyFailure, withInstallLock, writeText } from "./apply.js";
import { withoutBlock } from "./gitignore-block.js";
import { hashText } from "./hash.js";
import { parseSettings, renderJson, styleOf } from "./json-text.js";
import { LOCK_FILE, STATE_DIR } from "./layout.js";
import type { LockEntry, LockFile } from "./lock-file.js";
import type { Project } from "./project.js";
import { unmergeSettings } from "./settings-merge.js";

export const REMOVAL_ACTIONS = ["restore", "delete", "unmerge", "keep-edited", "gone", "keep-generated"] as const;

export type RemovalAction = (typeof REMOVAL_ACTIONS)[number];

export interface RemovalItem {
  readonly path: string;
  readonly action: RemovalAction;
  readonly after: string | undefined;
}

export interface RemovalOptions {
  readonly purge: boolean;
  readonly keepGenerated: boolean;
}

export interface RemovalPlan {
  readonly items: readonly RemovalItem[];
  readonly purge: boolean;
  readonly removeDirs: readonly string[];
}

const structural = (entry: LockEntry, current: string): string | undefined => {
  if (entry.kind === "gitignore") {
    const text = withoutBlock(current);
    return text === "" && !entry.existed ? undefined : text;
  }
  const parsed = parseSettings(current);
  if (!parsed.ok || entry.added === undefined) return current;
  const settings = unmergeSettings(parsed.value, entry.added, entry.handlers ?? []);
  return Object.keys(settings).length === 0 && !entry.existed ? undefined : renderJson(settings, styleOf(current));
};

const unchanged = (project: Project, entry: LockEntry): RemovalItem | undefined => {
  if (!entry.existed) return { path: entry.path, action: "delete", after: undefined };
  const original = entry.backup === undefined ? undefined : project.read(entry.backup);
  return original === undefined ? undefined : { path: entry.path, action: "restore", after: original };
};

const removalFor = (project: Project, entry: LockEntry, options: RemovalOptions): RemovalItem => {
  const current = project.read(entry.path);
  if (current === undefined) return { path: entry.path, action: "gone", after: undefined };
  if (entry.kind === "generated" && options.keepGenerated) {
    return { path: entry.path, action: "keep-generated", after: current };
  }
  if (hashText(current) === entry.hash) {
    const exact = unchanged(project, entry);
    if (exact !== undefined) return exact;
  }
  if (entry.kind === "generated") return { path: entry.path, action: "keep-edited", after: current };
  const after = structural(entry, current);
  return { path: entry.path, action: after === undefined ? "delete" : "unmerge", after };
};

export const planRemoval = (project: Project, lock: LockFile, options: RemovalOptions): RemovalPlan => ({
  items: lock.entries.map((entry) => removalFor(project, entry, options)),
  purge: options.purge,
  removeDirs: lock.createdDirs.filter((dir) => dir !== STATE_DIR),
});

const applyItem = (project: Project, item: RemovalItem): Parsed<undefined, ApplyFailure> => {
  if (item.action === "delete") {
    const removed = project.runtime.remove(project.abs(item.path));
    return removed.ok ? removed : reject({ path: item.path, detail: removed.error });
  }
  if (item.after === undefined || item.action === "gone" || item.action.startsWith("keep")) return accept(undefined);
  return writeText(project, item.path, item.after);
};

const isEmptyDir = (project: Project, relative: string): boolean => {
  const listed = project.runtime.listDir(project.abs(relative));
  return listed.ok && listed.value.length === 0;
};

const finish = (project: Project, plan: RemovalPlan): Parsed<undefined, ApplyFailure> => {
  const target = plan.purge ? STATE_DIR : LOCK_FILE;
  const removed = project.runtime.remove(project.abs(target));
  if (!removed.ok) return reject({ path: target, detail: removed.error });
  for (const dir of plan.removeDirs) if (isEmptyDir(project, dir)) project.runtime.remove(project.abs(dir));
  return accept(undefined);
};

export const applyRemoval = (project: Project, plan: RemovalPlan): Parsed<undefined, ApplyFailure> => {
  const changed = withInstallLock(project, () => {
    for (const item of plan.items) {
      const done = applyItem(project, item);
      if (!done.ok) return done;
    }
    return accept(undefined);
  });
  return changed.ok ? finish(project, plan) : changed;
};
