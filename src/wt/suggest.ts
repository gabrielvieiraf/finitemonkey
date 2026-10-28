import { toAbsolutePath } from "../core/brand.js";
import { nowMs } from "../core/clock.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import type { CleanupClass } from "./classify.js";
import { classifyAll, type Inventory } from "./inventory.js";

export const CLASSES_FILE = "wt-classes.json";
export const DISMISS_FILE = "wt-dismiss.json";
export const REFRESH_MS = 86_400_000;
export const CLEANABLE: ReadonlySet<string> = new Set<CleanupClass>(["contained", "equivalent"]);

export interface CachedClass {
  readonly path: string;
  readonly cls: string;
  readonly bytes: number | null;
}

export interface CachedClasses {
  readonly at: string;
  readonly startedAt: string | undefined;
  readonly worktrees: readonly CachedClass[];
}

export interface Cleanable {
  readonly count: number;
  readonly bytes: number;
}

const classOf = (value: unknown): CachedClass | undefined => {
  if (!isRecord(value)) return undefined;
  const { path, cls, bytes } = value;
  if (typeof path !== "string" || typeof cls !== "string") return undefined;
  return { path, cls, bytes: typeof bytes === "number" ? bytes : null };
};

export const readClasses = (runtime: Pick<Runtime, "readText">, paths: FmPaths): CachedClasses | undefined => {
  const raw = readJsonFile(runtime, paths.cache(CLASSES_FILE));
  if (raw === undefined) return undefined;
  const list = raw["worktrees"];
  return {
    at: typeof raw["at"] === "string" ? raw["at"] : "",
    startedAt: typeof raw["startedAt"] === "string" ? raw["startedAt"] : undefined,
    worktrees: Array.isArray(list) ? list.flatMap((item: unknown) => classOf(item) ?? []) : [],
  };
};

export const writeClasses = (
  runtime: Pick<Runtime, "writeText" | "now" | "exclusiveBytes">,
  paths: FmPaths,
  inventory: Inventory,
): readonly CachedClass[] => {
  const worktrees = classifyAll(inventory).map((item) => ({
    path: item.path,
    cls: item.cls,
    bytes: item.tree === undefined ? null : (runtime.exclusiveBytes(toAbsolutePath(item.path)) ?? null),
  }));
  writeJsonFile(runtime, paths.cache(CLASSES_FILE), { at: runtime.now(), worktrees });
  return worktrees;
};

export const markStarted = (runtime: Pick<Runtime, "readText" | "writeText" | "now">, paths: FmPaths): void => {
  const before = readJsonFile(runtime, paths.cache(CLASSES_FILE)) ?? {};
  writeJsonFile(runtime, paths.cache(CLASSES_FILE), { ...before, startedAt: runtime.now() });
};

const ageMs = (runtime: Pick<Runtime, "now">, at: string | undefined): number => {
  const parsed = at === undefined ? Number.NaN : Date.parse(at);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : nowMs(runtime) - parsed;
};

export const refreshDue = (runtime: Pick<Runtime, "now">, cached: CachedClasses | undefined): boolean =>
  cached === undefined ||
  (ageMs(runtime, cached.at === "" ? undefined : cached.at) >= REFRESH_MS &&
    ageMs(runtime, cached.startedAt) >= REFRESH_MS);

export const cleanableOf = (cached: CachedClasses): Cleanable => {
  const items = cached.worktrees.filter((item) => CLEANABLE.has(item.cls));
  return { count: items.length, bytes: items.reduce((sum, item) => sum + (item.bytes ?? 0), 0) };
};

export const dismissedCount = (runtime: Pick<Runtime, "readText">, paths: FmPaths): number => {
  const count = readJsonFile(runtime, paths.cache(DISMISS_FILE))?.["count"];
  return typeof count === "number" && Number.isInteger(count) ? count : 0;
};

export const dismiss = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, count: number): void => {
  writeJsonFile(runtime, paths.cache(DISMISS_FILE), { count });
};
