import { createHash } from "node:crypto";

export interface PlanInput {
  readonly tasks: readonly string[];
  readonly arms: readonly string[];
  readonly repeats: number;
  readonly seed: number;
}

export interface PlannedRun {
  readonly id: string;
  readonly task: string;
  readonly arm: string;
  readonly repeat: number;
  readonly seed: number;
  readonly taskSeed: number;
  readonly order: number;
}

export type Random = () => number;

export const seededRandom = (seed: number): Random => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

export const shuffled = <T>(items: readonly T[], random: Random): T[] => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    const current = copy[index];
    const swap = copy[other];
    if (current === undefined || swap === undefined) continue;
    copy[index] = swap;
    copy[other] = current;
  }
  return copy;
};

export const derivedSeed = (...parts: readonly (string | number)[]): number =>
  createHash("sha256").update(parts.map(String).join("\u0000")).digest().readUInt32BE(0);

export const runId = (task: string, arm: string, repeat: number, seed: number): string =>
  `${task}--${arm}--r${String(repeat)}--s${String(seed)}`;

export const plan = (input: PlanInput): readonly PlannedRun[] => {
  const random = seededRandom(input.seed);
  const tasks = shuffled(input.tasks, random);
  const runs: PlannedRun[] = [];
  for (let repeat = 0; repeat < input.repeats; repeat += 1) {
    for (const task of tasks) {
      const taskSeed = derivedSeed(input.seed, task, repeat);
      for (const arm of shuffled(input.arms, random)) {
        const id = runId(task, arm, repeat, input.seed);
        runs.push({ id, task, arm, repeat, seed: input.seed, taskSeed, order: runs.length });
      }
    }
  }
  return runs;
};
