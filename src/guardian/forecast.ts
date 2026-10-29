import type { Runtime } from "../core/runtime.js";
import { readLedger } from "../evidence/ledger.js";
import { type Evidence, GATE_CHECK } from "../evidence/types.js";
import type { FmPaths } from "../task/paths.js";
import type { TaskContract } from "../task/types.js";
import { almostDone } from "./signals.js";
import type { KnownTask } from "./tasks.js";

export const MIN_REFERENCE = 5;
export const ESCALATION_FACTOR = 2;

export interface PastTask {
  readonly id: string;
  readonly durationMs: number;
  readonly gateRuns: number;
}

export interface Forecast {
  readonly size: TaskContract["size"];
  readonly areas: readonly string[];
  readonly tasks: readonly PastTask[];
  readonly medianMs: number;
  readonly medianGateRuns: number;
}

export const areasOf = (contract: Pick<TaskContract, "scope">): readonly string[] =>
  [
    ...new Set(
      contract.scope.paths.map((path) =>
        path
          .replace(/^\.\//, "")
          .split("/")
          .filter((part) => part !== "")
          .slice(0, 2)
          .join("/"),
      ),
    ),
  ].filter((area) => area !== "");

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

export const pastTask = (id: string, ledger: readonly Evidence[]): PastTask | undefined => {
  const first = ledger[0];
  const gates = ledger.filter((entry) => entry.check === GATE_CHECK);
  const passed = gates.findIndex((entry) => entry.status === "passed");
  const done = gates[passed];
  if (first === undefined || done === undefined) return undefined;
  return { id, durationMs: Date.parse(done.at) - Date.parse(first.at), gateRuns: passed + 1 };
};

const comparable = (task: KnownTask, contract: TaskContract): boolean => {
  const wanted = new Set(areasOf(contract));
  return task.contract.size === contract.size && areasOf(task.contract).some((area) => wanted.has(area));
};

export const forecastFor = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  tasks: readonly KnownTask[],
  contract: TaskContract,
): Forecast | undefined => {
  const past = tasks
    .filter((task) => task.done && task.contract.id !== contract.id && comparable(task, contract))
    .flatMap((task) => pastTask(task.contract.id, readLedger(runtime, paths.evidence(task.contract.id))) ?? []);
  if (past.length < MIN_REFERENCE) return undefined;
  return {
    size: contract.size,
    areas: areasOf(contract),
    tasks: past,
    medianMs: median(past.map((item) => item.durationMs)),
    medianGateRuns: median(past.map((item) => item.gateRuns)),
  };
};

export const escalated = (
  runtime: Pick<Runtime, "readText" | "now">,
  paths: FmPaths,
  task: KnownTask,
  forecast: Forecast | undefined,
): number | undefined => {
  if (task.done || forecast === undefined) return undefined;
  const ledger = readLedger(runtime, paths.evidence(task.contract.id));
  const first = ledger[0];
  if (first === undefined || !almostDone(ledger)) return undefined;
  const elapsed = Date.parse(runtime.now()) - Date.parse(first.at);
  return elapsed > ESCALATION_FACTOR * forecast.medianMs ? elapsed : undefined;
};
