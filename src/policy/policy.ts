import { type AlertBudgetConfig, DEFAULT_ALERT_BUDGET } from "./budget.js";
import {
  type AutonomyConfig,
  type CalibrateConfig,
  DEFAULT_AUTONOMY,
  DEFAULT_CALIBRATE,
  DEFAULT_EVOLVE_MIN_TASKS,
  type EvolveConfig,
} from "./stage6.js";

export { loadBasePolicy, loadPolicy, policyPath, type PolicyRuntime, userPolicyPath } from "./load.js";
export { isPolicyError, parsePolicy, parseUserPolicy } from "./parse.js";
export type { AutonomyConfig, CalibrateConfig, EvolveConfig } from "./stage6.js";

export const POLICY_FILE = ".finitemonkey/policy.yml";
export const GUARD_MODES = ["off", "shadow", "active"] as const;
export const LEVELS = ["light", "standard", "strict"] as const;
export const DEFAULT_PROMOTE_AFTER = 20;
export const OPTIONAL_GUARDS = [
  "prose",
  "deps",
  "creds-static",
  "appsec",
  "signals",
  "fourth-attempt",
  "ricochete",
  "label",
  "relay",
  "reuse",
  "quality",
  "slop",
  "tests-hold",
  "regression",
  "advisor",
  "claims",
  "clarify",
  "deploy",
  "ui-review",
  "wt-suggest",
  "wt-place",
  "heavy-lock",
  "instructions",
  "rules-stop",
  "reminders",
  "learnings",
  "lint-gen",
  "pr-gen",
  "ownership",
  "ci-gen",
  "ci-audit",
  "ci-protect",
  "ci-watch",
  "infra",
  "deploy-plan",
  "deploy-generate",
  "deploy-drift",
  "headers",
  "observability",
  "gate-isolated",
  "golden",
  "mutation",
  "arch",
  "organize",
  "contract",
  "ds-sync",
  "python-preset",
  "onboard",
  "gate-hold",
  "test-pin",
  "evidence-inputs",
  "planta",
  "perfil",
  "conceitos",
  "alert-budget",
  "syntax-check",
  "early-loops",
  "reproduce-first",
  "scope",
  "front-scope",
  "behavior-contract",
  "divergence-ask",
  "predict-gate",
  "access-scenarios",
  "blind-tests",
  "decision-hold",
  "assumptions",
  "reality",
  "guardian-reuse",
  "proportionality",
  "forecast",
  "evolve",
  "calibrate",
  "autonomy",
  "mod-tighten",
  "mod-band",
  "attribution-trailer",
  "instruction-drift",
  "knowledge-claims",
  "claim-checks",
  "derived-cache",
  "memory-quarantine",
  "claim-promotion",
  "retrieve",
  "retrieve-deep",
  "decision-record",
  "knowledge-map",
  "remote-destructive",
  "migrate-check",
  "infra-plan",
  "restore-drill",
  "api-version",
  "cochange",
  "test-budget",
  "red-green",
  "explain-approval",
  "premise-check",
  "focus-card",
  "attention",
  "drift-sensor",
  "pr-provenance",
  "team-dashboard",
  "xray",
  "probes",
] as const;
export const DAMAGE_GUARDS = ["secrets", "gate", "git", "rules"] as const;
export const KNOWN_GUARDS: readonly string[] = [...DAMAGE_GUARDS, ...OPTIONAL_GUARDS];
export const POLICY_KEYS: readonly string[] = [
  "level",
  "promoteAfter",
  "projectLevel",
  "guards",
  "experiments",
  "rules",
  "learnings",
  "reminders",
  "quality",
  "alertBudget",
  "evolve",
  "calibrate",
  "autonomy",
  "knowledge",
  "person",
];
export const RETIRED_POLICY_KEYS: readonly string[] = ["severity"];
export const STARTS_IN_SHADOW: ReadonlySet<string> = new Set([
  "fourth-attempt",
  "claims",
  "clarify",
  "quality",
  "slop",
  "tests-hold",
  "regression",
  "advisor",
  "reminders",
  "learnings",
  "rules-stop",
  "gate-isolated",
  "gate-hold",
  "test-pin",
  "syntax-check",
  "early-loops",
  "reproduce-first",
  "scope",
  "front-scope",
  "behavior-contract",
  "divergence-ask",
  "predict-gate",
  "access-scenarios",
  "blind-tests",
  "decision-hold",
  "assumptions",
  "reality",
  "guardian-reuse",
  "proportionality",
  "forecast",
  "evolve",
  "calibrate",
  "autonomy",
  "attribution-trailer",
  "knowledge-claims",
  "claim-checks",
  "claim-promotion",
  "retrieve-deep",
  "knowledge-map",
  "remote-destructive",
  "migrate-check",
  "infra-plan",
  "restore-drill",
  "api-version",
  "cochange",
  "test-budget",
  "red-green",
  "explain-approval",
  "premise-check",
  "focus-card",
  "attention",
  "drift-sensor",
  "pr-provenance",
  "team-dashboard",
  "xray",
  "probes",
]);

export type GuardMode = (typeof GUARD_MODES)[number];
export type Level = (typeof LEVELS)[number];
export type PolicyIssueKind = "unknown_key" | "retired_key" | "unknown_guard" | "invalid_mode" | "unknown_experiment";

export interface PolicyIssue {
  readonly kind: PolicyIssueKind;
  readonly file: string;
  readonly key: string;
  readonly suggestion?: string;
}

export interface Policy {
  readonly exists: boolean;
  readonly level: Level;
  readonly promoteAfter: number;
  readonly guards: Readonly<Record<string, GuardMode>>;
  readonly userGuards: Readonly<Record<string, GuardMode>>;
  readonly experiments: Readonly<Record<string, "random">>;
  readonly alertBudget: AlertBudgetConfig;
  readonly alertBudgetSet: readonly string[];
  readonly evolved: Readonly<Record<string, GuardMode>>;
  readonly evolve: EvolveConfig;
  readonly calibrate: CalibrateConfig;
  readonly autonomy: AutonomyConfig;
  readonly issues: readonly PolicyIssue[];
}

export const DEFAULT_POLICY: Policy = {
  exists: false,
  level: "standard",
  promoteAfter: DEFAULT_PROMOTE_AFTER,
  guards: {},
  userGuards: {},
  experiments: {},
  alertBudget: DEFAULT_ALERT_BUDGET,
  alertBudgetSet: [],
  evolved: {},
  evolve: { minTasks: DEFAULT_EVOLVE_MIN_TASKS },
  calibrate: DEFAULT_CALIBRATE,
  autonomy: DEFAULT_AUTONOMY,
  issues: [],
};

export const USER_POLICY_FILE = "~/.finitemonkey/policy.yml";
