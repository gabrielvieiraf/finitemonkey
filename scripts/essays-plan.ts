import { type Anim, type Motion, num, type SvgItem } from "./essays-svg.js";

export interface Step {
  readonly at: number;
  readonly a: Anim;
  readonly els: readonly number[];
  readonly gap?: number;
  readonly d?: number;
  readonly from?: number;
  readonly chain?: number;
}

export interface Placed {
  readonly item: SvgItem;
  readonly motion?: Motion;
}

export interface Plan {
  readonly count: number;
  readonly still: readonly number[];
  readonly steps: readonly Step[];
  readonly redraw?: (placed: readonly Placed[], prefix: string) => Placed[];
}

export const span = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const size = (item: SvgItem, a: Anim): number => Math.max(num(item, a === "right" ? "width" : "height"), 0.1);

function stepMotions(step: Step, items: readonly SvgItem[]): [number, Motion][] {
  const picked = step.els.map((i) => {
    const item = items[i];
    if (!item) throw new Error(`figure plan points at element ${String(i)}, which does not exist`);
    return item;
  });
  if (step.chain !== undefined) {
    const total = picked.reduce((sum, item) => sum + size(item, step.a), 0);
    let t = step.at;
    return picked.map((item, k): [number, Motion] => {
      const d = ((step.chain ?? 0) * size(item, step.a)) / total;
      const motion: Motion = { a: step.a, t, d, chain: true };
      t += d;
      return [step.els[k] ?? 0, motion];
    });
  }
  return step.els.map((i, k): [number, Motion] => [
    i,
    { a: step.a, t: step.at + k * (step.gap ?? 0), d: step.d, from: step.from },
  ]);
}

export function place(plan: Plan, items: readonly SvgItem[], prefix: string, name: string): Placed[] {
  if (items.length !== plan.count) {
    throw new Error(`${name} has ${String(items.length)} elements, its motion plan expects ${String(plan.count)}`);
  }
  const motions = new Map<number, Motion>();
  for (const step of plan.steps) for (const [i, m] of stepMotions(step, items)) motions.set(i, m);
  const loose = items.map((_, i) => i).filter((i) => !motions.has(i) && !plan.still.includes(i));
  if (loose.length > 0) throw new Error(`${name}: elements ${loose.join(", ")} have no motion and are not still`);
  const placed = items.map((item, i) => ({ item, motion: motions.get(i) }));
  return plan.redraw ? plan.redraw(placed, prefix) : placed;
}
