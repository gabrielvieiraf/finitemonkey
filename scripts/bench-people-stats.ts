export interface PairedEstimate {
  readonly n: number;
  readonly estimate: number;
  readonly low: number;
  readonly high: number;
}

const T_975: readonly number[] = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11,
  2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

export const MAX_EXACT = 20;

export const average = (values: readonly number[]): number =>
  values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length;

export const median = (values: readonly number[]): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? Number.NaN;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? Number.NaN) + upper) / 2;
};

export const tCritical = (df: number): number => T_975[Math.min(df, T_975.length) - 1] ?? Number.NaN;

export const pairedInterval = (differences: readonly number[]): PairedEstimate | undefined => {
  const n = differences.length;
  if (n < 2) return undefined;
  const estimate = average(differences);
  const variance = differences.reduce((sum, value) => sum + (value - estimate) ** 2, 0) / (n - 1);
  const margin = tCritical(n - 1) * Math.sqrt(variance / n);
  return { n, estimate, low: estimate - margin, high: estimate + margin };
};

export const signFlipP = (differences: readonly number[]): number | undefined => {
  const n = differences.length;
  if (n === 0 || n > MAX_EXACT) return undefined;
  const observed = Math.abs(differences.reduce((sum, value) => sum + value, 0));
  const total = 2 ** n;
  let extreme = 0;
  for (let mask = 0; mask < total; mask += 1) {
    const flipped = differences.reduce((sum, value, index) => sum + ((mask >> index) & 1 ? -value : value), 0);
    if (Math.abs(flipped) >= observed - 1e-9) extreme += 1;
  }
  return extreme / total;
};
