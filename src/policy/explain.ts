import type { FmPaths } from "../task/paths.js";
import { experimentArm } from "./experiment.js";
import { type GuardResolution, type ModeSource, type Override, readShadow, resolveGuard } from "./guards.js";
import {
  DAMAGE_GUARDS,
  type GuardMode,
  isPolicyError,
  KNOWN_GUARDS,
  loadPolicy,
  type PolicyIssue,
  type PolicyRuntime,
} from "./policy.js";

export const POLICY_EXPLAIN_SCHEMA = "finitemonkey/policy-explain@1";

export type FailureMode = "block" | "log" | "none";

export interface GuardExplain {
  readonly guard: string;
  readonly damage: boolean;
  readonly mode: GuardMode;
  readonly source: ModeSource;
  readonly failureMode: FailureMode;
  readonly ignored: readonly Override[];
}

export interface PolicyExplainData {
  readonly schema: typeof POLICY_EXPLAIN_SCHEMA;
  readonly guards: readonly GuardExplain[];
  readonly issues: readonly PolicyIssue[];
  readonly errors: number;
}

const FAILURE: Readonly<Record<GuardMode, FailureMode>> = { active: "block", shadow: "log", off: "none" };

const row = (guard: string, damage: boolean, resolved: GuardResolution): GuardExplain => ({
  guard,
  damage,
  mode: resolved.mode,
  source: resolved.source,
  failureMode: FAILURE[resolved.mode],
  ignored: resolved.ignored,
});

export const explainPolicy = (runtime: PolicyRuntime, paths: FmPaths): PolicyExplainData => {
  const policy = loadPolicy(runtime, paths.root);
  const shadow = readShadow(runtime, paths);
  const damage: readonly string[] = DAMAGE_GUARDS;
  const guards = KNOWN_GUARDS.map((guard) => {
    const set = { id: guard, damage: damage.includes(guard) };
    return row(guard, set.damage, resolveGuard(set, policy, shadow, experimentArm(runtime, paths, policy, guard)));
  });
  return {
    schema: POLICY_EXPLAIN_SCHEMA,
    guards,
    issues: policy.issues,
    errors: policy.issues.filter(isPolicyError).length,
  };
};
