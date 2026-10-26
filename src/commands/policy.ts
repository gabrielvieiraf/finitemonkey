import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { readShadow, writeShadow } from "../policy/guards.js";
import { OPTIONAL_GUARDS } from "../policy/policy.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export interface FalsePositiveData {
  readonly guard: string;
  readonly falsePositives: number;
}

const FIX = `finitemonkey policy false-positive <${OPTIONAL_GUARDS.join("|")}>`;

const recordFalsePositive = (ctx: Ctx, guard: string): CommandResult<FalsePositiveData> => {
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("policy.error.person_only", FIX));
  if (!OPTIONAL_GUARDS.some((id) => id === guard)) {
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "error.invalid_arguments", FIX, { detail: guard }));
  }
  const paths = fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);
  const state = readShadow(ctx.runtime, paths);
  const before = state[guard] ?? { firings: 0, falsePositives: 0, promoted: false };
  const falsePositives = before.falsePositives + 1;
  writeShadow(ctx.runtime, paths, { ...state, [guard]: { ...before, falsePositives } });
  logEvent(ctx.runtime, paths, "guard_false_positive", { guard, falsePositives });
  return success({ guard, falsePositives }, [
    ctx.t("policy.false_positive.recorded", { guard, count: falsePositives }),
  ]);
};

export const policyFalsePositiveCommand: CommandSpec = {
  path: ["policy", "false-positive"],
  summaryKey: "command.policy_false_positive.summary",
  usage: FIX,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => Promise.resolve(recordFalsePositive(ctx, args.positionals[0] ?? "")),
};
