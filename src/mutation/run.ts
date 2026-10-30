import { dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { runShellCheck } from "../gate/checks/command.js";
import { installFrozen, removeScratch, scratchDir } from "../gate/isolated.js";
import type { GateContext } from "../gate/types.js";
import type { AcceptanceCheck } from "../task/types.js";
import { applyMutant, type Mutant } from "./operators.js";

export type MutationRun =
  | {
      readonly kind: "ran";
      readonly killed: readonly Mutant[];
      readonly survived: readonly Mutant[];
      readonly skipped: number;
    }
  | { readonly kind: "baseline_failed" }
  | { readonly kind: "unavailable"; readonly detail: string };

type Verdict = "killed" | "survived" | "skipped";

export const copyWorking = (ctx: GateContext, dir: AbsolutePath): void => {
  for (const change of ctx.changes) {
    const target = toAbsolutePath(join(dir, change.path));
    if (change.status === "D") {
      ctx.runtime.remove(target);
      continue;
    }
    ctx.runtime.mkdir(toAbsolutePath(dirname(target)));
    ctx.runtime.copyFile(toAbsolutePath(join(ctx.paths.root, change.path)), target);
  }
};

const verdictOf = (
  at: GateContext,
  tests: AcceptanceCheck,
  run: string,
  dir: AbsolutePath,
  mutant: Mutant,
): Verdict => {
  const path = toAbsolutePath(join(dir, mutant.file));
  const original = at.runtime.readText(path);
  const mutated = original.ok ? applyMutant(original.value, mutant) : undefined;
  if (!original.ok || mutated === undefined) return "skipped";
  at.runtime.writeText(path, mutated);
  try {
    const outcome = runShellCheck(tests, run, at);
    if (outcome.reason === "budget") return "skipped";
    return outcome.status === "passed" ? "survived" : "killed";
  } finally {
    at.runtime.writeText(path, original.value);
  }
};

const insideScratch = (
  ctx: GateContext,
  dir: AbsolutePath,
  tests: AcceptanceCheck,
  run: string,
  mutants: readonly Mutant[],
): MutationRun => {
  copyWorking(ctx, dir);
  const installed = installFrozen(ctx.runtime, dir, ctx.deadline);
  if (!installed.ok) return { kind: "unavailable", detail: installed.error.detail };
  const at: GateContext = { ...ctx, paths: { ...ctx.paths, root: dir }, baseline: undefined };
  if (runShellCheck(tests, run, at).status !== "passed") return { kind: "baseline_failed" };
  const verdicts = mutants.map((mutant) => ({ mutant, verdict: verdictOf(at, tests, run, dir, mutant) }));
  const pick = (verdict: Verdict): readonly Mutant[] =>
    verdicts.filter((item) => item.verdict === verdict).map((item) => item.mutant);
  return { kind: "ran", killed: pick("killed"), survived: pick("survived"), skipped: pick("skipped").length };
};

export const runMutants = (
  ctx: GateContext,
  tests: AcceptanceCheck,
  run: string,
  mutants: readonly Mutant[],
): MutationRun => {
  const root = ctx.paths.root;
  const dir = scratchDir(ctx.runtime, root, "mutation");
  const added = ctx.runtime.gitWith(["worktree", "add", "--detach", "--force", dir, "HEAD"], root, {});
  try {
    return added.ok
      ? insideScratch(ctx, dir, tests, run, mutants)
      : { kind: "unavailable", detail: added.stderr.trim() };
  } finally {
    removeScratch(ctx.runtime, root, dir);
  }
};
