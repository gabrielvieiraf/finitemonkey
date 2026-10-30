import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import { scriptsDigest } from "../gate/scripts-digest.js";
import {
  evolveModeOf,
  type EvolveState,
  readEvolve,
  type Variant,
  variantArm,
  writeEvolve,
} from "../policy/evolved.js";
import { type GuardMode, loadBasePolicy } from "../policy/policy.js";
import type { FmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import { countedOutcomes, evaluatorChanged, verdictFor } from "./evaluate.js";
import { dismissalTimes, type TaskOutcome, taskOutcome } from "./outcome.js";
import { newVariants, proposals } from "./propose.js";

export interface Waiting {
  readonly id: string;
  readonly variantTasks: number;
  readonly parentTasks: number;
}

export interface EvolveRun {
  readonly mode: GuardMode;
  readonly halted: readonly string[];
  readonly proposed: readonly string[];
  readonly promoted: readonly string[];
  readonly rejected: readonly string[];
  readonly waiting: readonly Waiting[];
}

export type EvolveRuntime = Pick<Runtime, "readText" | "writeText" | "appendText" | "now" | "homeDir" | "selfPath">;

const recordArms = (
  runtime: EvolveRuntime,
  paths: FmPaths,
  variants: readonly Variant[],
  task: string,
  mode: GuardMode,
): readonly Variant[] =>
  variants.map((variant): Variant => {
    if (variant.status !== "trial" || variant.tasks[task] !== undefined) return variant;
    const arm = variant.bornTask === task ? "off" : variantArm(task, variant.id);
    logEvent(runtime, paths, "evolve_arm", { variant: variant.id, task, arm, mode });
    return { ...variant, tasks: { ...variant.tasks, [task]: { arm, mode } } };
  });

const outcomesFor = (
  runtime: EvolveRuntime,
  paths: FmPaths,
  variants: readonly Variant[],
  done: ReadonlySet<string>,
): ReadonlyMap<string, TaskOutcome> => {
  const wanted = new Set(
    variants
      .flatMap((variant) => (variant.status === "trial" ? Object.keys(variant.tasks) : []))
      .filter((task) => done.has(task)),
  );
  if (wanted.size === 0) return new Map();
  const dismissals = dismissalTimes(runtime, paths);
  return new Map(
    [...wanted].flatMap((task): [string, TaskOutcome][] => {
      const outcome = taskOutcome(runtime, paths, task, dismissals);
      return outcome === undefined ? [] : [[task, outcome]];
    }),
  );
};

interface Decided {
  readonly variants: readonly Variant[];
  readonly promoted: readonly string[];
  readonly rejected: readonly string[];
  readonly waiting: readonly Waiting[];
}

const decide = (
  runtime: EvolveRuntime,
  paths: FmPaths,
  variants: readonly Variant[],
  outcomes: ReadonlyMap<string, TaskOutcome>,
  minTasks: number,
): Decided => {
  const promoted: string[] = [];
  const rejected: string[] = [];
  const waiting: Waiting[] = [];
  const decided = variants.map((variant): Variant => {
    if (variant.status !== "trial") return variant;
    const verdict = verdictFor(variant, countedOutcomes(variant, outcomes), minTasks);
    if (verdict.kind === "waiting") {
      waiting.push({ id: variant.id, variantTasks: verdict.variantTasks, parentTasks: verdict.parentTasks });
      return variant;
    }
    (verdict.kind === "promote" ? promoted : rejected).push(variant.id);
    logEvent(runtime, paths, verdict.kind === "promote" ? "policy_promoted" : "policy_variant_rejected", {
      variant: variant.id,
      variantTasks: verdict.evidence.variant.tasks.length,
      parentTasks: verdict.evidence.parent.tasks.length,
    });
    return {
      ...variant,
      status: verdict.kind === "promote" ? "promoted" : "rejected",
      decidedAt: runtime.now(),
      evidence: verdict.evidence,
    };
  });
  return { variants: decided, promoted, rejected, waiting };
};

const haltedBy = (
  variants: readonly Variant[],
  outcomes: ReadonlyMap<string, TaskOutcome>,
  current: string,
): readonly string[] =>
  variants
    .filter((variant) => {
      if (variant.status !== "trial") return false;
      const counted = countedOutcomes(variant, outcomes);
      return evaluatorChanged(variant, [...counted.variant, ...counted.parent], current);
    })
    .map((variant) => variant.id);

export const runEvolve = (runtime: EvolveRuntime, paths: FmPaths, record: boolean): EvolveRun => {
  const policy = loadBasePolicy(runtime, paths.root);
  const taskState = readState(runtime, paths);
  const task = taskState.active;
  const mode = evolveModeOf(policy, task);
  if (mode === "off") return { mode, halted: [], proposed: [], promoted: [], rejected: [], waiting: [] };
  const before = readEvolve(runtime, paths.root);
  const current = scriptsDigest(runtime, paths.root);
  const recorded =
    record && task !== undefined ? recordArms(runtime, paths, before.variants, task, mode) : before.variants;
  const outcomes = outcomesFor(runtime, paths, recorded, new Set(taskState.done));
  const halted = haltedBy(recorded, outcomes, current);
  if (halted.length > 0) logEvent(runtime, paths, "evolve_halted", { variants: [...halted], evaluator: current });
  const decided: Decided =
    halted.length > 0
      ? { variants: recorded, promoted: [], rejected: [], waiting: [] }
      : decide(runtime, paths, recorded, outcomes, policy.evolve.minTasks);
  const added = newVariants(decided.variants, proposals(runtime, paths, policy), {
    task: task ?? null,
    at: runtime.now(),
    evaluator: current,
  });
  for (const variant of added)
    logEvent(runtime, paths, "evolve_proposed", { variant: variant.id, reason: variant.reason, task: task ?? null });
  const next: EvolveState = {
    variants: [...decided.variants, ...added],
    unseen: [...before.unseen, ...decided.promoted],
  };
  if (JSON.stringify(next) !== JSON.stringify(before)) writeEvolve(runtime, paths.root, next);
  return { mode, halted, proposed: added.map((variant) => variant.id), ...decided };
};
