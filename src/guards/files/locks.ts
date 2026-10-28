import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../../core/brand.js";
import { isRecord, parseJsonObject } from "../../core/parsed.js";
import { toPosixPath } from "../../core/posix-path.js";
import type { Runtime } from "../../core/runtime.js";
import { sha256Hex } from "../../secrets/fingerprint.js";

export const LOCKS_DIR = ".finitemonkey/locks";
export const LOCK_STALE_MS = 12 * 60 * 60 * 1000;

export interface FileLock {
  readonly path: string;
  readonly owner: string;
  readonly at: string;
}

const lockDir = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(root, LOCKS_DIR));

const lockFile = (root: AbsolutePath, path: string): AbsolutePath =>
  toAbsolutePath(join(lockDir(root), `file-${sha256Hex(toPosixPath(path)).slice(0, 24)}.json`));

const parseLock = (text: string): FileLock | undefined => {
  const parsed = parseJsonObject(text);
  if (!parsed.ok || !isRecord(parsed.value)) return undefined;
  const { path, owner, at } = parsed.value;
  return typeof path === "string" && typeof owner === "string" && typeof at === "string"
    ? { path, owner, at }
    : undefined;
};

const isStale = (runtime: Runtime, lock: FileLock): boolean =>
  Date.parse(runtime.now()) - Date.parse(lock.at) > LOCK_STALE_MS;

export const lockOf = (runtime: Runtime, root: AbsolutePath, path: string): FileLock | undefined => {
  const text = runtime.readText(lockFile(root, path));
  const lock = text.ok ? parseLock(text.value) : undefined;
  return lock === undefined || isStale(runtime, lock) ? undefined : lock;
};

export type Claim = { readonly kind: "mine" } | { readonly kind: "taken"; readonly lock: FileLock };

export const claimFile = (runtime: Runtime, root: AbsolutePath, path: string, owner: string): Claim => {
  const current = lockOf(runtime, root, path);
  if (current !== undefined && current.owner !== owner) return { kind: "taken", lock: current };
  if (current === undefined) {
    runtime.mkdir(lockDir(root));
    const lock: FileLock = { path: toPosixPath(path), owner, at: runtime.now() };
    runtime.writeAtomic(lockFile(root, path), `${JSON.stringify(lock)}\n`);
  }
  return { kind: "mine" };
};

export const releaseOwner = (runtime: Runtime, root: AbsolutePath, owner: string): readonly string[] => {
  const names = runtime.listDir(lockDir(root));
  if (!names.ok) return [];
  return names.value
    .filter((name) => name.startsWith("file-") && name.endsWith(".json"))
    .flatMap((name) => {
      const file = toAbsolutePath(join(lockDir(root), name));
      const text = runtime.readText(file);
      const lock = text.ok ? parseLock(text.value) : undefined;
      if (lock?.owner !== owner) return [];
      runtime.remove(file);
      return [lock.path];
    });
};
