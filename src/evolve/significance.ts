import { type Interval, SIGNIFICANCE_TEST, type SignificanceResult } from "../policy/evolved.js";
import type { TaskOutcome } from "./outcome.js";

const Z975 = 1.959964;

export const METRICS: Readonly<Record<string, (outcome: TaskOutcome) => number>> = {
  falseDone: (outcome) => (outcome.falseDone ? 1 : 0),
  dismissals: (outcome) => outcome.dismissals,
  wallMs: (outcome) => outcome.wallMs,
};

const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

const variance = (values: readonly number[]): number => {
  const center = mean(values);
  return values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1);
};

export const tCritical = (df: number): number => {
  if (!Number.isFinite(df) || df <= 0) return Z975;
  const z = Z975;
  return (
    z +
    (z ** 3 + z) / (4 * df) +
    (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2) +
    (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3)
  );
};

export const welchInterval = (left: readonly number[], right: readonly number[]): Interval | null => {
  if (left.length < 2 || right.length < 2) return null;
  const a = variance(left) / left.length;
  const b = variance(right) / right.length;
  const diff = mean(left) - mean(right);
  const se = Math.sqrt(a + b);
  if (se === 0) return [diff, diff];
  const df = (a + b) ** 2 / (a ** 2 / (left.length - 1) + b ** 2 / (right.length - 1));
  const spread = tCritical(df) * se;
  return [diff - spread, diff + spread];
};

export const significance = (variant: readonly TaskOutcome[], parent: readonly TaskOutcome[]): SignificanceResult => {
  const intervals = Object.fromEntries(
    Object.entries(METRICS).map(([name, metric]) => [name, welchInterval(variant.map(metric), parent.map(metric))]),
  );
  const passed = Object.values(intervals).some((interval) => interval !== null && interval[1] < 0);
  return { name: SIGNIFICANCE_TEST, passed, intervals };
};
