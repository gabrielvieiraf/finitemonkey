import type { Runtime } from "../core/runtime.js";
import { dismissalTimes, taskOutcome } from "../evolve/outcome.js";
import { forecastFor } from "../guardian/forecast.js";
import type { KnownTask } from "../guardian/tasks.js";
import type { AutonomyConfig } from "../policy/policy.js";
import type { FmPaths } from "../task/paths.js";
import type { AcceptanceCheck, TaskContract, TaskSize } from "../task/types.js";

export const SUCCESS_RATE = 0.8;
export const MIN_HISTORY = 5;
const MINUTE = 60_000;
export const SIZE_ESTIMATE_MS: Readonly<Record<TaskSize, number>> = {
  S: 30 * MINUTE,
  M: 120 * MINUTE,
  L: 480 * MINUTE,
};

export interface Horizon {
  readonly ms: number;
  readonly source: "local" | "published";
  readonly tasks: number;
}

export interface Estimate {
  readonly ms: number;
  readonly source: "forecast" | "size";
}

export type Plan =
  | { readonly kind: "single"; readonly horizon: Horizon; readonly estimate: Estimate }
  | {
      readonly kind: "split";
      readonly horizon: Horizon;
      readonly estimate: Estimate;
      readonly pieces: readonly (readonly AcceptanceCheck[])[];
    }
  | { readonly kind: "refuse"; readonly horizon: Horizon; readonly estimate: Estimate; readonly needed: number };

export const localHorizon = (
  runs: readonly { readonly wallMs: number; readonly ok: boolean }[],
  config: AutonomyConfig,
): Horizon => {
  const published: Horizon = {
    ms: config.publishedHorizonMinutes * MINUTE * config.margin,
    source: "published",
    tasks: runs.length,
  };
  if (runs.length < MIN_HISTORY) return published;
  const sorted = [...runs].sort((left, right) => left.wallMs - right.wallMs);
  let best: number | undefined;
  let ok = 0;
  sorted.forEach((run, index) => {
    if (run.ok) ok += 1;
    if (index + 1 >= MIN_HISTORY && ok / (index + 1) >= SUCCESS_RATE) best = run.wallMs;
  });
  return best === undefined ? published : { ms: best, source: "local", tasks: runs.length };
};

export const historyRuns = (
  runtime: Pick<Runtime, "readText" | "homeDir">,
  paths: FmPaths,
  tasks: readonly KnownTask[],
): readonly { readonly wallMs: number; readonly ok: boolean }[] => {
  const dismissals = dismissalTimes(runtime, paths);
  return tasks
    .filter((task) => task.done)
    .flatMap((task) => {
      const outcome = taskOutcome(runtime, paths, task.contract.id, dismissals);
      return outcome === undefined ? [] : [{ wallMs: outcome.wallMs, ok: !outcome.falseDone }];
    });
};

export const estimateOf = (
  runtime: Pick<Runtime, "readText" | "homeDir">,
  paths: FmPaths,
  tasks: readonly KnownTask[],
  contract: TaskContract,
): Estimate => {
  const forecast = forecastFor(runtime, paths, tasks, contract);
  return forecast === undefined
    ? { ms: SIZE_ESTIMATE_MS[contract.size], source: "size" }
    : { ms: forecast.medianMs, source: "forecast" };
};

const chunks = <T>(items: readonly T[], count: number): readonly (readonly T[])[] =>
  Array.from({ length: count }, (_, index) =>
    items.slice(Math.floor((index * items.length) / count), Math.floor(((index + 1) * items.length) / count)),
  );

export const planRun = (contract: TaskContract, horizon: Horizon, estimate: Estimate): Plan => {
  const needed = Math.max(1, Math.ceil(estimate.ms / Math.max(1, horizon.ms)));
  if (needed === 1) return { kind: "single", horizon, estimate };
  if (needed > contract.acceptance.length) return { kind: "refuse", horizon, estimate, needed };
  return { kind: "split", horizon, estimate, pieces: chunks(contract.acceptance, needed) };
};
