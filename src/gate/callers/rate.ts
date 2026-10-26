import { isRecord, parseJsonObject } from "../../core/parsed.js";
import type { Runtime } from "../../core/runtime.js";
import type { FmPaths } from "../../task/paths.js";

export const FLAGGED_EVENT = "callers.flagged";
export const RELEASED_EVENT = "callers.released";
export const MIN_SAMPLE = 20;
export const MAX_FALSE_POSITIVE = 0.05;

export interface CallersRate {
  readonly flagged: number;
  readonly released: number;
  readonly rate: number;
  readonly downgraded: boolean;
}

const pairs = (record: Readonly<Record<string, unknown>>): readonly string[] => {
  const { task, names } = record;
  if (typeof task !== "string" || !Array.isArray(names)) return [];
  return names.filter((name): name is string => typeof name === "string").map((name) => `${task}\0${name}`);
};

export const callersRate = (runtime: Pick<Runtime, "readText">, paths: FmPaths): CallersRate => {
  const text = runtime.readText(paths.log);
  const flagged = new Set<string>();
  const released = new Set<string>();
  for (const line of text.ok ? text.value.split("\n") : []) {
    const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
    if (parsed === undefined || !parsed.ok || !isRecord(parsed.value)) continue;
    const event = parsed.value["event"];
    const target = event === FLAGGED_EVENT ? flagged : event === RELEASED_EVENT ? released : undefined;
    if (target !== undefined) for (const pair of pairs(parsed.value)) target.add(pair);
  }
  const total = new Set([...flagged, ...released]).size;
  const rate = total === 0 ? 0 : released.size / total;
  return {
    flagged: total,
    released: released.size,
    rate,
    downgraded: total >= MIN_SAMPLE && rate > MAX_FALSE_POSITIVE,
  };
};
