import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { installFrozen, removeScratch, scratchDir } from "../gate/isolated.js";
import type { GateContext } from "../gate/types.js";
import { applyMutant, type Mutant } from "./operators.js";
import { copyWorking } from "./run.js";

export interface Criterion {
  readonly id: string;
  readonly passes: (at: GateContext) => boolean | undefined;
}

export interface CriterionStrength {
  readonly id: string;
  readonly killed: number;
  readonly total: number;
  readonly measured: boolean;
}

export type StrengthRun =
  | { readonly kind: "ran"; readonly criteria: readonly CriterionStrength[] }
  | { readonly kind: "unavailable"; readonly detail: string };

export const isDecorative = (item: CriterionStrength): boolean => item.measured && item.total > 0 && item.killed === 0;

const killedBy = (at: GateContext, dir: AbsolutePath, mutant: Mutant, live: readonly Criterion[]): Set<string> => {
  const path = toAbsolutePath(join(dir, mutant.file));
  const original = at.runtime.readText(path);
  const mutated = original.ok ? applyMutant(original.value, mutant) : undefined;
  if (!original.ok || mutated === undefined) return new Set();
  at.runtime.writeText(path, mutated);
  try {
    return new Set(live.filter((criterion) => criterion.passes(at) === false).map((criterion) => criterion.id));
  } finally {
    at.runtime.writeText(path, original.value);
  }
};

const measure = (
  ctx: GateContext,
  dir: AbsolutePath,
  criteria: readonly Criterion[],
  mutants: readonly Mutant[],
): StrengthRun => {
  copyWorking(ctx, dir);
  const installed = installFrozen(ctx.runtime, dir, ctx.deadline);
  if (!installed.ok) return { kind: "unavailable", detail: installed.error.detail };
  const at: GateContext = { ...ctx, paths: { ...ctx.paths, root: dir }, baseline: undefined };
  const live = criteria.filter((criterion) => criterion.passes(at) === true);
  const kills = mutants.map((mutant) => killedBy(at, dir, mutant, live));
  return {
    kind: "ran",
    criteria: criteria.map((criterion) => ({
      id: criterion.id,
      killed: kills.filter((set) => set.has(criterion.id)).length,
      total: mutants.length,
      measured: live.includes(criterion),
    })),
  };
};

export const measureStrength = (
  ctx: GateContext,
  criteria: readonly Criterion[],
  mutants: readonly Mutant[],
): StrengthRun => {
  const root = ctx.paths.root;
  const dir = scratchDir(ctx.runtime, root, "strength");
  const added = ctx.runtime.gitWith(["worktree", "add", "--detach", "--force", dir, "HEAD"], root, {});
  try {
    return added.ok ? measure(ctx, dir, criteria, mutants) : { kind: "unavailable", detail: added.stderr.trim() };
  } finally {
    removeScratch(ctx.runtime, root, dir);
  }
};
