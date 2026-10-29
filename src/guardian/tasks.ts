import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml } from "../core/yaml/parse.js";
import { parseContract } from "../task/load.js";
import type { FmPaths } from "../task/paths.js";
import { type GateTrust, readState, readTrust } from "../task/state.js";
import type { TaskContract } from "../task/types.js";

export interface KnownTask {
  readonly contract: TaskContract;
  readonly goals: readonly string[];
  readonly approved?: TaskContract;
  readonly done: boolean;
}

export const taskList = (text: string, key: string): readonly string[] => {
  const parsed = parseYaml(text);
  if (!parsed.ok || !isRecord(parsed.value)) return [];
  const raw = parsed.value[key];
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return list.flatMap((item: unknown) => (typeof item === "string" && item.trim() !== "" ? [item.trim()] : []));
};

const taskOf = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  trust: GateTrust,
  done: ReadonlySet<string>,
  id: string,
): KnownTask | undefined => {
  const text = runtime.readText(paths.task(id));
  if (!text.ok) return undefined;
  const contract = parseContract(id, text.value);
  if (!contract.ok) return undefined;
  const approvedText = trust.approved[id];
  const approved = approvedText === undefined ? undefined : parseContract(id, approvedText);
  return {
    contract: contract.value,
    goals: taskList(text.value, "goals"),
    ...(approved?.ok === true ? { approved: approved.value } : {}),
    done: done.has(id),
  };
};

export const knownTasks = (runtime: Pick<Runtime, "readText" | "listDir">, paths: FmPaths): readonly KnownTask[] => {
  const listed = runtime.listDir(toAbsolutePath(join(paths.dir, "tasks")));
  const names = listed.ok ? [...listed.value].filter((name) => name.endsWith(".yml")).sort() : [];
  const trust = readTrust(runtime, paths);
  const done = new Set(readState(runtime, paths).done);
  return names.flatMap((name) => taskOf(runtime, paths, trust, done, name.replace(/\.yml$/, "")) ?? []);
};

export const activeTask = (runtime: Pick<Runtime, "readText">, paths: FmPaths): KnownTask | undefined => {
  const state = readState(runtime, paths);
  return state.active === undefined
    ? undefined
    : taskOf(runtime, paths, readTrust(runtime, paths), new Set(state.done), state.active);
};
