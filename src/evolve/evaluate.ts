import type { ArmSummary, Variant, VariantEvidence } from "../policy/evolved.js";
import type { TaskOutcome } from "./outcome.js";

export type Verdict =
  | { readonly kind: "waiting"; readonly variantTasks: number; readonly parentTasks: number }
  | { readonly kind: "promote" | "reject"; readonly evidence: VariantEvidence };

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const ratio = (count: number, total: number): number => (total === 0 ? 0 : count / total);

export const summarize = (outcomes: readonly TaskOutcome[]): ArmSummary => ({
  tasks: outcomes.map((outcome) => outcome.task),
  falseDone: ratio(outcomes.filter((outcome) => outcome.falseDone).length, outcomes.length),
  dismissals: ratio(
    outcomes.reduce((sum, outcome) => sum + outcome.dismissals, 0),
    outcomes.length,
  ),
  medianWallMs: median(outcomes.map((outcome) => outcome.wallMs)),
});

export const beats = (variant: ArmSummary, parent: ArmSummary): boolean => {
  const pairs: readonly [number, number][] = [
    [variant.falseDone, parent.falseDone],
    [variant.dismissals, parent.dismissals],
    [variant.medianWallMs, parent.medianWallMs],
  ];
  return pairs.every(([mine, theirs]) => mine <= theirs) && pairs.some(([mine, theirs]) => mine < theirs);
};

export const countedOutcomes = (
  variant: Variant,
  outcomes: ReadonlyMap<string, TaskOutcome>,
): { readonly variant: readonly TaskOutcome[]; readonly parent: readonly TaskOutcome[] } => {
  const pick = (arm: "active" | "off"): readonly TaskOutcome[] =>
    Object.entries(variant.tasks).flatMap(([task, record]) => {
      if (task === variant.bornTask || record.mode !== "active" || record.arm !== arm) return [];
      const outcome = outcomes.get(task);
      return outcome === undefined ? [] : [outcome];
    });
  return { variant: pick("active"), parent: pick("off") };
};

export const evaluatorChanged = (variant: Variant, counted: readonly TaskOutcome[], current: string): boolean =>
  current !== variant.evaluator ||
  counted.some((outcome) => outcome.evaluators.some((hash) => hash !== variant.evaluator));

export const verdictFor = (
  variant: Variant,
  counted: { readonly variant: readonly TaskOutcome[]; readonly parent: readonly TaskOutcome[] },
  minTasks: number,
): Verdict => {
  if (counted.variant.length < minTasks || counted.parent.length < minTasks)
    return { kind: "waiting", variantTasks: counted.variant.length, parentTasks: counted.parent.length };
  const evidence: VariantEvidence = {
    variant: summarize(counted.variant),
    parent: summarize(counted.parent),
    evaluator: variant.evaluator,
  };
  return { kind: beats(evidence.variant, evidence.parent) ? "promote" : "reject", evidence };
};
