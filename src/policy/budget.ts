import { nowMs } from "../core/clock.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { ConfigTree } from "../git/project-config.js";
import { configMap } from "../git/project-config.js";
import type { FmPaths } from "../task/paths.js";

export const ALERT_BUDGET_FILE = "alert-budget.json";
export const ALERT_BUDGET_FEATURE = "alert-budget";
const DAY_MS = 86_400_000;
const KEEP_PER_CLASS = 200;

export interface AlertBudgetConfig {
  readonly muteAbove: number;
  readonly windowDays: number;
  readonly minFirings: number;
}

export const DEFAULT_ALERT_BUDGET: AlertBudgetConfig = { muteAbove: 0.15, windowDays: 30, minFirings: 10 };
export const ALERT_BUDGET_KEYS: readonly string[] = ["muteAbove", "windowDays", "minFirings"];

interface ClassLog {
  readonly fired: readonly number[];
  readonly dismissed: readonly number[];
}

export type BudgetState = Readonly<Record<string, ClassLog>>;

export interface ClassRate {
  readonly guard: string;
  readonly fired: number;
  readonly dismissed: number;
  readonly rate: number;
  readonly muted: boolean;
}

const numberIn = (raw: string | undefined, valid: (value: number) => boolean, fallback: number): number => {
  const value = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(value) && valid(value) ? value : fallback;
};

export const parseAlertBudget = (tree: ConfigTree): AlertBudgetConfig => {
  const raw = configMap(tree, "alertBudget");
  return {
    muteAbove: numberIn(raw["muteAbove"], (value) => value > 0 && value <= 1, DEFAULT_ALERT_BUDGET.muteAbove),
    windowDays: numberIn(
      raw["windowDays"],
      (value) => Number.isInteger(value) && value > 0,
      DEFAULT_ALERT_BUDGET.windowDays,
    ),
    minFirings: numberIn(
      raw["minFirings"],
      (value) => Number.isInteger(value) && value > 0,
      DEFAULT_ALERT_BUDGET.minFirings,
    ),
  };
};

const times = (value: unknown): readonly number[] =>
  Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];

export const readBudget = (runtime: Pick<Runtime, "readText">, paths: FmPaths): BudgetState => {
  const text = runtime.readText(paths.cache(ALERT_BUDGET_FILE));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  if (parsed?.ok !== true) return {};
  return Object.fromEntries(
    Object.entries(parsed.value).flatMap(([guard, value]): [string, ClassLog][] =>
      isRecord(value) ? [[guard, { fired: times(value["fired"]), dismissed: times(value["dismissed"]) }]] : [],
    ),
  );
};

const record = (
  runtime: Pick<Runtime, "readText" | "writeText" | "now">,
  paths: FmPaths,
  guard: string,
  field: keyof ClassLog,
): BudgetState => {
  const state = readBudget(runtime, paths);
  const before = state[guard] ?? { fired: [], dismissed: [] };
  const next = { ...state, [guard]: { ...before, [field]: [...before[field], nowMs(runtime)].slice(-KEEP_PER_CLASS) } };
  runtime.writeText(paths.cache(ALERT_BUDGET_FILE), `${JSON.stringify(next)}\n`);
  return next;
};

export const recordFiring = (
  runtime: Pick<Runtime, "readText" | "writeText" | "now">,
  paths: FmPaths,
  guard: string,
): BudgetState => record(runtime, paths, guard, "fired");

export const recordDismissal = (
  runtime: Pick<Runtime, "readText" | "writeText" | "now">,
  paths: FmPaths,
  guard: string,
): BudgetState => record(runtime, paths, guard, "dismissed");

export const classRate = (guard: string, log: ClassLog, config: AlertBudgetConfig, now: number): ClassRate => {
  const from = now - config.windowDays * DAY_MS;
  const fired = log.fired.filter((at) => at >= from).length;
  const dismissed = log.dismissed.filter((at) => at >= from).length;
  const rate = fired === 0 ? 0 : dismissed / fired;
  return { guard, fired, dismissed, rate, muted: fired >= config.minFirings && rate > config.muteAbove };
};

export const classRates = (state: BudgetState, config: AlertBudgetConfig, now: number): readonly ClassRate[] =>
  Object.entries(state)
    .map(([guard, log]) => classRate(guard, log, config, now))
    .sort((left, right) => left.guard.localeCompare(right.guard));

export const isMuted = (state: BudgetState, config: AlertBudgetConfig, now: number, guard: string): boolean => {
  const log = state[guard];
  return log !== undefined && classRate(guard, log, config, now).muted;
};
