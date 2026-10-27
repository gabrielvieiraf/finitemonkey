import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, isRecord, type Parsed, reject } from "../core/parsed.js";
import type { ReleaseLock, Runtime } from "../core/runtime.js";
import { parseYaml } from "../core/yaml/parse.js";
import { stringifyYaml } from "../core/yaml/write.js";
import { entryYaml, parseEntry, REGISTRY_SCHEMA, type WorktreeEntry } from "./entry.js";

export const REGISTRY_DIR = "finitemonkey";
export const REGISTRY_FILE = "worktrees.yml";

const LOCK_STALE_MS = 15_000;
const LOCK_WAIT_MS = 5_000;
const LOCK_STEP_MS = 15;

export interface Registry {
  readonly worktrees: readonly WorktreeEntry[];
}

export const EMPTY_REGISTRY: Registry = { worktrees: [] };

export const commonDirOf = (runtime: Runtime, cwd: AbsolutePath): AbsolutePath | undefined => {
  const result = runtime.git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  const dir = result.stdout.trim();
  return result.ok && dir !== "" ? toAbsolutePath(dir) : undefined;
};

export const registryDir = (commonDir: AbsolutePath): AbsolutePath => toAbsolutePath(join(commonDir, REGISTRY_DIR));

export const registryPath = (commonDir: AbsolutePath): AbsolutePath =>
  toAbsolutePath(join(registryDir(commonDir), REGISTRY_FILE));

export const parseRegistry = (text: string): Parsed<Registry> => {
  if (text.trim() === "") return accept(EMPTY_REGISTRY);
  const parsed = parseYaml(text);
  if (!parsed.ok) return reject(`line ${String(parsed.error.line)}: ${parsed.error.message}`);
  const root = parsed.value;
  if (!isRecord(root)) return reject("expected a mapping at the top");
  const list = root["worktrees"] ?? [];
  if (!Array.isArray(list)) return reject("worktrees must be a list");
  return accept({ worktrees: list.flatMap((item) => parseEntry(item) ?? []) });
};

export const serializeRegistry = (registry: Registry): string =>
  stringifyYaml({ schema: REGISTRY_SCHEMA, worktrees: registry.worktrees.map(entryYaml) });

export const readRegistry = (runtime: Runtime, commonDir: AbsolutePath): Parsed<Registry> => {
  const path = registryPath(commonDir);
  if (runtime.stat(path) === undefined) return accept(EMPTY_REGISTRY);
  const text = runtime.readText(path);
  return text.ok ? parseRegistry(text.value) : reject(text.error);
};

const pause = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const acquire = (runtime: Runtime, path: AbsolutePath, owner: string): Parsed<ReleaseLock> => {
  const attempts = Math.ceil(LOCK_WAIT_MS / LOCK_STEP_MS);
  for (let attempt = 1; ; attempt += 1) {
    const lock = runtime.lock(path, { staleMs: LOCK_STALE_MS, owner });
    if (lock.ok || !lock.error.startsWith("locked") || attempt >= attempts) return lock;
    pause(LOCK_STEP_MS + (attempt % 3) * 5);
  }
};

const WRITE_ATTEMPTS = 8;

const writeWithRetry = (runtime: Runtime, path: AbsolutePath, text: string): Parsed<undefined> => {
  let written = runtime.writeAtomic(path, text);
  for (let attempt = 1; !written.ok && attempt < WRITE_ATTEMPTS; attempt += 1) {
    pause(LOCK_STEP_MS * attempt);
    written = runtime.writeAtomic(path, text);
  }
  return written;
};

export type RegistryChange<T, E> = (
  registry: Registry,
) => Parsed<{ readonly registry: Registry; readonly result: T }, E>;

export const updateRegistry = <T, E = string>(
  runtime: Runtime,
  commonDir: AbsolutePath,
  owner: string,
  change: RegistryChange<T, E>,
): Parsed<T, E | string> => {
  const made = runtime.mkdir(registryDir(commonDir));
  if (!made.ok) return made;
  const path = registryPath(commonDir);
  const lock = acquire(runtime, toAbsolutePath(`${path}.lock`), owner);
  if (!lock.ok) return lock;
  try {
    const current = readRegistry(runtime, commonDir);
    if (!current.ok) return reject(`${path}: ${current.error}`);
    const next = change(current.value);
    if (!next.ok) return next;
    if (next.value.registry === current.value) return accept(next.value.result);
    const written = writeWithRetry(runtime, path, serializeRegistry(next.value.registry));
    return written.ok ? accept(next.value.result) : reject(written.error);
  } finally {
    lock.value();
  }
};

export const upsertEntry = (registry: Registry, entry: WorktreeEntry): Registry => {
  const others = registry.worktrees.filter((item) => item.id !== entry.id);
  return { worktrees: [...others, entry] };
};
