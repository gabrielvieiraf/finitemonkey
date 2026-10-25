import { dirname } from "node:path";

import { accept, type Parsed, reject } from "../core/parsed.js";
import { hashText } from "./hash.js";
import {
  BACKUPS_DIR,
  INSTALL_LOCK,
  INSTALL_LOCK_STALE_MS,
  LOCK_FILE,
  LOCK_SCHEMA,
  LOCKS_DIR,
  STATE_DIR,
} from "./layout.js";
import { type LockEntry, type LockFile, renderLock } from "./lock-file.js";
import { CHANGING, type Plan, type PlanItem } from "./plan.js";
import type { Project } from "./project.js";

export interface Applied {
  readonly lock: LockFile;
  readonly written: readonly string[];
  readonly backup: string | undefined;
}

export interface ApplyFailure {
  readonly path: string;
  readonly detail: string;
}

export const stamp = (iso: string): string => iso.replace(/[:.]/g, "-");

const ensureParent = (project: Project, relative: string): Parsed<undefined> =>
  project.runtime.mkdir(project.abs(dirname(relative)));

export const writeText = (project: Project, relative: string, text: string): Parsed<undefined, ApplyFailure> => {
  const parent = ensureParent(project, relative);
  const written = parent.ok ? project.runtime.writeAtomic(project.abs(relative), text) : parent;
  return written.ok ? accept(undefined) : reject({ path: relative, detail: written.error });
};

const restore = (project: Project, items: readonly PlanItem[]): void => {
  for (const item of items) {
    if (item.before === undefined) project.runtime.remove(project.abs(item.path));
    else project.runtime.writeAtomic(project.abs(item.path), item.before);
  }
};

const backupItems = (project: Project, dir: string, items: readonly PlanItem[]): Parsed<undefined, ApplyFailure> => {
  const manifest = items.map((item) => ({ path: item.path, hash: hashText(item.before ?? "") }));
  for (const item of items) {
    const saved = writeText(project, `${dir}/${item.path}`, item.before ?? "");
    if (!saved.ok) return saved;
  }
  return writeText(project, `${dir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
};

const entryOf = (plan: Plan, item: PlanItem, backupDir: string | undefined): LockEntry => {
  const previous = plan.previous?.entries.find((entry) => entry.path === item.path);
  const existed = previous?.existed ?? item.before !== undefined;
  const backup = previous?.backup ?? (existed && backupDir !== undefined ? `${backupDir}/${item.path}` : undefined);
  const hash =
    item.action === "keep-edited" ? (previous?.hash ?? hashText(item.proposal ?? item.after)) : hashText(item.after);
  return {
    path: item.path,
    kind: item.kind,
    existed,
    hash,
    ...(backup === undefined ? {} : { backup }),
    ...(item.added === undefined ? {} : { added: item.added }),
    ...(item.handlers === undefined ? {} : { handlers: item.handlers }),
  };
};

const nextLock = (
  plan: Plan,
  version: string,
  now: string,
  backupDir: string | undefined,
  createdDirs: readonly string[],
): LockFile => ({
  schema: LOCK_SCHEMA,
  version,
  preset: plan.preset,
  installedAt: plan.previous?.installedAt ?? now,
  updatedAt: now,
  createdDirs: plan.previous?.createdDirs ?? createdDirs,
  entries: plan.items.filter((item) => item.action !== "skip-foreign").map((item) => entryOf(plan, item, backupDir)),
});

const needsBackup = (plan: Plan, item: PlanItem): boolean =>
  item.before !== undefined && plan.previous?.entries.find((entry) => entry.path === item.path)?.backup === undefined;

const writeAll = (project: Project, items: readonly PlanItem[]): Parsed<undefined, ApplyFailure> => {
  const done: PlanItem[] = [];
  for (const item of items) {
    const written = writeText(project, item.path, item.after);
    if (!written.ok) {
      restore(project, done);
      return written;
    }
    done.push(item);
  }
  return accept(undefined);
};

const createdBy = (project: Project): readonly string[] => [".claude", STATE_DIR].filter((dir) => !project.exists(dir));

const commit = (
  project: Project,
  plan: Plan,
  version: string,
  createdDirs: readonly string[],
): Parsed<Applied, ApplyFailure> => {
  const now = project.runtime.now();
  const changing = plan.items.filter((item) => CHANGING.includes(item.action));
  const toBackup = changing.filter((item) => needsBackup(plan, item));
  const backupDir = toBackup.length === 0 ? undefined : `${BACKUPS_DIR}/${stamp(now)}`;
  if (backupDir !== undefined) {
    const saved = backupItems(project, backupDir, toBackup);
    if (!saved.ok) return saved;
  }
  const written = writeAll(project, changing);
  if (!written.ok) return written;
  const lock = nextLock(plan, version, now, backupDir, createdDirs);
  const locked = writeText(project, LOCK_FILE, renderLock(lock));
  if (!locked.ok) {
    restore(project, changing);
    return locked;
  }
  return accept({ lock, written: changing.map((item) => item.path), backup: backupDir });
};

export const withInstallLock = <T>(project: Project, work: () => Parsed<T, ApplyFailure>): Parsed<T, ApplyFailure> => {
  const dir = project.runtime.mkdir(project.abs(LOCKS_DIR));
  if (!dir.ok) return reject({ path: LOCKS_DIR, detail: dir.error });
  const lock = project.runtime.lock(project.abs(INSTALL_LOCK), {
    staleMs: INSTALL_LOCK_STALE_MS,
    owner: "finitemonkey",
  });
  if (!lock.ok) return reject({ path: INSTALL_LOCK, detail: lock.error });
  try {
    return work();
  } finally {
    lock.value();
  }
};

export const applyPlan = (project: Project, plan: Plan, version: string): Parsed<Applied, ApplyFailure> => {
  const created = createdBy(project);
  return withInstallLock(project, () => commit(project, plan, version, created));
};
