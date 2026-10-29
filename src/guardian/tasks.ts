import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml } from "../core/yaml/parse.js";
import { parseContract } from "../task/load.js";
import type { FmPaths } from "../task/paths.js";
import { readState, readTrust } from "../task/state.js";
import type { TaskContract } from "../task/types.js";

export interface KnownTask {
  readonly contract: TaskContract;
  readonly goals: readonly string[];
  readonly approved?: TaskContract;
  readonly done: boolean;
}

const linkedGoals = (text: string): readonly string[] => {
  const parsed = parseYaml(text);
  if (!parsed.ok || !isRecord(parsed.value)) return [];
  const raw = parsed.value["goals"];
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return list.flatMap((item: unknown) => (typeof item === "string" && item.trim() !== "" ? [item.trim()] : []));
};

export const knownTasks = (runtime: Pick<Runtime, "readText" | "listDir">, paths: FmPaths): readonly KnownTask[] => {
  const listed = runtime.listDir(toAbsolutePath(join(paths.dir, "tasks")));
  const names = listed.ok ? [...listed.value].filter((name) => name.endsWith(".yml")).sort() : [];
  const trust = readTrust(runtime, paths);
  const done = new Set(readState(runtime, paths).done);
  return names.flatMap((name) => {
    const id = name.replace(/\.yml$/, "");
    const text = runtime.readText(paths.task(id));
    if (!text.ok) return [];
    const contract = parseContract(id, text.value);
    if (!contract.ok) return [];
    const approvedText = trust.approved[id];
    const approved = approvedText === undefined ? undefined : parseContract(id, approvedText);
    return [
      {
        contract: contract.value,
        goals: linkedGoals(text.value),
        ...(approved?.ok === true ? { approved: approved.value } : {}),
        done: done.has(id),
      },
    ];
  });
};
