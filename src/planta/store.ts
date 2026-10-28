import type { Runtime } from "../core/runtime.js";
import { stringifyYaml } from "../core/yaml/write.js";
import { readApprovals } from "../guards/release/grants.js";
import { parseContract } from "../task/load.js";
import { type FmPaths } from "../task/paths.js";
import { contractYaml } from "../task/serialize.js";
import { readJsonFile, readState, readTrust, writeJsonFile, writeTrust } from "../task/state.js";
import { APPROVAL_TASK, type BlueprintBar } from "./evaluate.js";
import { type BlueprintType, parseBlueprintType } from "./types.js";

export const PLANTA_CACHE = "planta.json";

export interface CachedBar {
  readonly type: BlueprintType;
  readonly green: number;
  readonly total: number;
  readonly next: string | undefined;
  readonly tree: string | undefined;
}

export const readCachedBar = (runtime: Pick<Runtime, "readText">, paths: FmPaths): CachedBar | undefined => {
  const raw = readJsonFile(runtime, paths.cache(PLANTA_CACHE));
  const type = parseBlueprintType(typeof raw?.["type"] === "string" ? raw["type"] : undefined);
  const green = raw?.["green"];
  const total = raw?.["total"];
  if (type === undefined || typeof green !== "number" || typeof total !== "number") return undefined;
  const next = raw?.["next"];
  const tree = raw?.["tree"];
  return {
    type,
    green,
    total,
    next: typeof next === "string" ? next : undefined,
    tree: typeof tree === "string" ? tree : undefined,
  };
};

export const writeCachedBar = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, bar: BlueprintBar): boolean =>
  writeJsonFile(runtime, paths.cache(PLANTA_CACHE), {
    type: bar.type,
    green: bar.green,
    total: bar.total,
    next: bar.next ?? null,
    tree: bar.tree ?? null,
  }).ok;

export const approvedItems = (runtime: Pick<Runtime, "readText">, paths: FmPaths): ReadonlySet<string> =>
  new Set(
    readApprovals(runtime, paths)
      .filter((approval) => approval.task === APPROVAL_TASK)
      .map((approval) => approval.check),
  );

const contractText = (runtime: Pick<Runtime, "readText">, paths: FmPaths, task: string): string | undefined => {
  const approved = readTrust(runtime, paths).approved[task];
  if (approved !== undefined) return approved;
  const disk = runtime.readText(paths.task(task));
  return disk.ok ? disk.value : undefined;
};

export const activeBlueprint = (runtime: Pick<Runtime, "readText">, paths: FmPaths): BlueprintType | undefined => {
  const task = readState(runtime, paths).active;
  const text = task === undefined ? undefined : contractText(runtime, paths, task);
  if (task === undefined || text === undefined) return undefined;
  const parsed = parseContract(task, text);
  return parsed.ok ? parsed.value.blueprint : undefined;
};

export const recordInContract = (
  runtime: Pick<Runtime, "readText" | "writeText">,
  paths: FmPaths,
  type: BlueprintType,
): string | undefined => {
  const task = readState(runtime, paths).active;
  const text = task === undefined ? undefined : contractText(runtime, paths, task);
  if (task === undefined || text === undefined) return undefined;
  const parsed = parseContract(task, text);
  if (!parsed.ok) return undefined;
  const updated = stringifyYaml(contractYaml({ ...parsed.value, blueprint: type }));
  if (!runtime.writeText(paths.task(task), updated).ok) return undefined;
  const lock = readTrust(runtime, paths);
  if (lock.approved[task] !== undefined)
    writeTrust(runtime, paths, { ...lock, approved: { ...lock.approved, [task]: updated } });
  return task;
};
