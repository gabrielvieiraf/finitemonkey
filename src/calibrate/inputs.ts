import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";

export const CALIBRATE_INPUTS = ["divergence", "decorative", "areaHistory"] as const;

export type InputName = (typeof CALIBRATE_INPUTS)[number];

export type Inputs = Readonly<Record<InputName, number>>;

export const INPUT_EVENTS: readonly string[] = ["divergence.outcome", "contract.strength"];

export interface TaskSignals {
  readonly divergence: number;
  readonly decorative: number;
}

const decorativeShare = (criteria: unknown, decorative: unknown): number => {
  const total = Array.isArray(criteria) ? criteria.length : 0;
  const weak = Array.isArray(decorative) ? decorative.length : 0;
  return total === 0 ? 0 : Math.min(1, weak / total);
};

export const readSignals = (runtime: Pick<Runtime, "readText">, paths: FmPaths): ReadonlyMap<string, TaskSignals> => {
  const text = runtime.readText(paths.log);
  const signals = new Map<string, TaskSignals>();
  if (!text.ok) return signals;
  for (const line of text.value.split("\n")) {
    if (!INPUT_EVENTS.some((event) => line.includes(event))) continue;
    const parsed = parseJsonObject(line);
    if (!parsed.ok || !isRecord(parsed.value)) continue;
    const { event, task } = parsed.value;
    if (typeof task !== "string" || typeof event !== "string" || !INPUT_EVENTS.includes(event)) continue;
    const before = signals.get(task) ?? { divergence: 0, decorative: 0 };
    signals.set(
      task,
      event === "divergence.outcome"
        ? { ...before, divergence: parsed.value["kind"] === "question" ? 1 : before.divergence }
        : { ...before, decorative: decorativeShare(parsed.value["criteria"], parsed.value["decorative"]) },
    );
  }
  return signals;
};

export const inputsOf = (signals: TaskSignals | undefined, areaHistory: number): Inputs => ({
  divergence: signals?.divergence ?? 0,
  decorative: signals?.decorative ?? 0,
  areaHistory,
});

export const vectorOf = (inputs: Inputs): readonly number[] => CALIBRATE_INPUTS.map((name) => inputs[name]);
