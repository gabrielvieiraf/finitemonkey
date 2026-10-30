import type { Runtime } from "../core/runtime.js";
import { readLedger } from "../evidence/ledger.js";
import { forecastFor } from "../guardian/forecast.js";
import type { KnownTask } from "../guardian/tasks.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";

const HORIZON_FILE = "timebox.json";
export const HORIZON_QUANTILE = 0.8;

export const quantile = (values: readonly number[], share: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1));
  return sorted[index] ?? 0;
};

type HorizonRuntime = Pick<Runtime, "readText" | "writeText" | "homeDir">;

export const horizonFor = (
  runtime: HorizonRuntime,
  paths: FmPaths,
  tasks: () => readonly KnownTask[],
  task: KnownTask,
): number | undefined => {
  const file = paths.cache(HORIZON_FILE);
  const cached = readJsonFile(runtime, file);
  if (cached?.["task"] === task.contract.id) {
    const value = cached["horizonMs"];
    return typeof value === "number" ? value : undefined;
  }
  const forecast = forecastFor(runtime, paths, tasks(), task.contract);
  const horizonMs =
    forecast === undefined
      ? null
      : quantile(
          forecast.tasks.map((item) => item.durationMs),
          HORIZON_QUANTILE,
        );
  writeJsonFile(runtime, file, { task: task.contract.id, horizonMs });
  return horizonMs ?? undefined;
};

export const elapsedMs = (
  runtime: Pick<Runtime, "readText" | "homeDir" | "now">,
  paths: FmPaths,
  task: KnownTask,
): number | undefined => {
  const first = readLedger(runtime, paths.evidence(task.contract.id))[0];
  return first === undefined ? undefined : Date.parse(runtime.now()) - Date.parse(first.at);
};
