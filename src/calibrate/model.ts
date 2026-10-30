export interface Sample {
  readonly x: readonly number[];
  readonly y: 0 | 1;
}

export interface Logistic {
  readonly weights: readonly number[];
  readonly bias: number;
}

const ITERATIONS = 2000;
const RATE = 0.5;
const L2 = 0.01;

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));

export const predict = (model: Logistic, x: readonly number[]): number =>
  sigmoid(model.weights.reduce((sum, weight, index) => sum + weight * (x[index] ?? 0), model.bias));

export const fitLogistic = (samples: readonly Sample[], width: number): Logistic => {
  let weights: readonly number[] = Array.from({ length: width }, () => 0);
  let bias = 0;
  const n = Math.max(1, samples.length);
  for (let step = 0; step < ITERATIONS; step += 1) {
    const model = { weights, bias };
    const errors = samples.map((sample) => predict(model, sample.x) - sample.y);
    weights = weights.map((weight, index) => {
      const gradient = samples.reduce((sum, sample, row) => sum + (errors[row] ?? 0) * (sample.x[index] ?? 0), 0) / n;
      return weight - RATE * (gradient + L2 * weight);
    });
    bias -= (RATE * errors.reduce((sum, error) => sum + error, 0)) / n;
  }
  return { weights, bias };
};
