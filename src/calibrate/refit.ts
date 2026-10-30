import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import { areasOf } from "../guardian/forecast.js";
import { knownTasks } from "../guardian/tasks.js";
import { loadPolicy } from "../policy/policy.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { COLORS, decide, type Decision, STATES } from "./decide.js";
import { CALIBRATE_INPUTS, type Inputs, inputsOf, readSignals, vectorOf } from "./inputs.js";
import { areaHistory, labelsFor } from "./labels.js";
import { fitLogistic, type Logistic } from "./model.js";

export const CALIBRATION_FILE = "calibration.json";

export interface Calibration {
  readonly fittedAt: string;
  readonly labels: number;
  readonly bad: number;
  readonly minLabels: number;
  readonly model?: Logistic;
  readonly decisions: Readonly<Record<string, Decision>>;
}

export type RefitRuntime = Pick<
  Runtime,
  "readText" | "writeText" | "appendText" | "now" | "homeDir" | "listDir" | "exec"
>;

export const computeCalibration = (
  runtime: Omit<RefitRuntime, "writeText" | "appendText">,
  paths: FmPaths,
): Calibration => {
  const policy = loadPolicy(runtime, paths.root);
  const tasks = knownTasks(runtime, paths);
  const labels = labelsFor(runtime, paths, tasks);
  const signals = readSignals(runtime, paths);
  const samples = labels.map((label) => ({
    x: vectorOf(inputsOf(signals.get(label.task), areaHistory(labels, label.areas, label.endMs))),
    y: label.bad ? (1 as const) : (0 as const),
  }));
  const model = labels.length >= policy.calibrate.minLabels ? fitLogistic(samples, CALIBRATE_INPUTS.length) : undefined;
  const open = tasks.filter((task) => !task.done);
  const decisions = Object.fromEntries(
    open.map((task) => {
      const inputs = inputsOf(
        signals.get(task.contract.id),
        areaHistory(labels, areasOf(task.contract), Number.POSITIVE_INFINITY),
      );
      return [task.contract.id, decide(inputs, model, policy.calibrate)];
    }),
  );
  return {
    fittedAt: runtime.now(),
    labels: labels.length,
    bad: labels.filter((label) => label.bad).length,
    minLabels: policy.calibrate.minLabels,
    ...(model === undefined ? {} : { model }),
    decisions,
  };
};

export const refitCalibration = (runtime: RefitRuntime, paths: FmPaths): Calibration => {
  const calibration = computeCalibration(runtime, paths);
  const { model } = calibration;
  writeJsonFile(runtime, paths.cache(CALIBRATION_FILE), { ...calibration });
  logEvent(runtime, paths, "calibrate.refit", {
    labels: calibration.labels,
    bad: calibration.bad,
    by: model === undefined ? "rules" : "model",
  });
  return calibration;
};

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const inputsFrom = (value: unknown): Inputs | undefined => {
  if (!isRecord(value)) return undefined;
  const [divergence, decorative, history] = CALIBRATE_INPUTS.map((name) => num(value[name]));
  return divergence === undefined || decorative === undefined || history === undefined
    ? undefined
    : { divergence, decorative, areaHistory: history };
};

export const readDecision = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  task: string,
): (Decision & { readonly labels: number }) | undefined => {
  const raw = readJsonFile(runtime, paths.cache(CALIBRATION_FILE));
  const decisions = raw?.["decisions"];
  const entry = isRecord(decisions) ? decisions[task] : undefined;
  if (!isRecord(entry)) return undefined;
  const state = STATES.find((item) => item === entry["state"]);
  const inputs = inputsFrom(entry["inputs"]);
  const by = entry["by"] === "model" ? "model" : entry["by"] === "rules" ? "rules" : undefined;
  if (state === undefined || inputs === undefined || by === undefined) return undefined;
  const probability = num(entry["probability"]);
  return {
    state,
    by,
    inputs,
    labels: num(raw?.["labels"]) ?? 0,
    ...(probability === undefined ? {} : { probability }),
  };
};

export const colorOf = (decision: Pick<Decision, "state">): string => COLORS[decision.state];
