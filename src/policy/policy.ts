import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { closest } from "../core/suggest.js";
import { configAt, configMap, type ConfigTree, parseConfigYaml } from "../git/project-config.js";
import { ALERT_BUDGET_KEYS, type AlertBudgetConfig, DEFAULT_ALERT_BUDGET, parseAlertBudget } from "./budget.js";
import { withEvolved } from "./evolved.js";
import {
  type AutonomyConfig,
  type CalibrateConfig,
  DEFAULT_AUTONOMY,
  DEFAULT_CALIBRATE,
  DEFAULT_EVOLVE_MIN_TASKS,
  type EvolveConfig,
  parseAutonomy,
  parseCalibrate,
  parseEvolve,
  sectionKeyIssues,
} from "./stage6.js";

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

const pick = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.find((option) => option === value) ?? fallback;

const issue = (
  kind: PolicyIssueKind,
  file: string,
  key: string,
  candidates: readonly string[],
  value: string = key,
): PolicyIssue => {
  const suggestion = closest(value, candidates);
  return suggestion === undefined ? { kind, file, key } : { kind, file, key, suggestion };
};

const guardModes = (tree: ConfigTree, file: string): [Record<string, GuardMode>, PolicyIssue[]] => {
  const guards: Record<string, GuardMode> = {};
  const issues: PolicyIssue[] = [];
  for (const [id, mode] of Object.entries(configMap(tree, "guards"))) {
    const known = GUARD_MODES.find((option) => option === mode);
    if (!KNOWN_GUARDS.includes(id)) issues.push(issue("unknown_guard", file, `guards.${id}`, KNOWN_GUARDS, id));
    else if (known === undefined) issues.push(issue("invalid_mode", file, `guards.${id}`, GUARD_MODES, mode));
    else guards[id] = known;
  }
  return [guards, issues];
};

const keyIssues = (tree: ConfigTree, file: string, allowed: readonly string[]): PolicyIssue[] =>
  Object.keys(tree).flatMap((key): PolicyIssue[] => {
    if (allowed.includes(key)) return [];
    if (RETIRED_POLICY_KEYS.includes(key)) return [{ kind: "retired_key", file, key }];
    return [issue("unknown_key", file, key, allowed)];
  });

export const parsePolicy = (text: string): Policy => {
  const tree = parseConfigYaml(text);
  const raw = configAt(tree, "promoteAfter");
  const promoteAfter = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  const [guards, guardIssues] = guardModes(tree, POLICY_FILE);
  const experimentIssues: PolicyIssue[] = [];
  const experiments = Object.fromEntries(
    Object.entries(configMap(tree, "experiments")).flatMap(([id, mode]): [string, "random"][] => {
      if (!KNOWN_GUARDS.includes(id)) {
        experimentIssues.push(issue("unknown_experiment", POLICY_FILE, `experiments.${id}`, KNOWN_GUARDS, id));
        return [];
      }
      return mode === "random" ? [[id, "random"]] : [];
    }),
  );
  return {
    exists: true,
    level: pick(LEVELS, configAt(tree, "level"), DEFAULT_POLICY.level),
    promoteAfter: Number.isInteger(promoteAfter) && promoteAfter > 0 ? promoteAfter : DEFAULT_PROMOTE_AFTER,
    guards,
    userGuards: {},
    experiments,
    alertBudget: parseAlertBudget(tree),
    alertBudgetSet: Object.keys(configMap(tree, "alertBudget")).filter((key) => ALERT_BUDGET_KEYS.includes(key)),
    evolved: {},
    evolve: parseEvolve(tree),
    calibrate: parseCalibrate(tree),
    autonomy: parseAutonomy(tree),
    issues: [
      ...keyIssues(tree, POLICY_FILE, POLICY_KEYS),
      ...Object.keys(configMap(tree, "alertBudget"))
        .filter((key) => !ALERT_BUDGET_KEYS.includes(key))
        .map((key) => issue("unknown_key", POLICY_FILE, `alertBudget.${key}`, ALERT_BUDGET_KEYS, key)),
      ...sectionKeyIssues(tree).map(([path, key, keys]) => issue("unknown_key", POLICY_FILE, path, keys, key)),
      ...guardIssues,
      ...experimentIssues,
    ],
  };
};

export const parseUserPolicy = (text: string): Pick<Policy, "userGuards" | "issues"> => {
  const tree = parseConfigYaml(text);
  const [userGuards, issues] = guardModes(tree, USER_POLICY_FILE);
  return { userGuards, issues: [...keyIssues(tree, USER_POLICY_FILE, ["guards"]), ...issues] };
};

export const isPolicyError = (found: PolicyIssue): boolean => found.kind !== "retired_key";

export const policyPath = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(root, POLICY_FILE));

export const userPolicyPath = (home: string): AbsolutePath => toAbsolutePath(join(home, ".finitemonkey", "policy.yml"));

export type PolicyRuntime = Pick<Runtime, "readText" | "homeDir">;

export const loadBasePolicy = (runtime: PolicyRuntime, root: AbsolutePath): Policy => {
  const text = runtime.readText(policyPath(root));
  const project = text.ok ? parsePolicy(text.value) : DEFAULT_POLICY;
  const userText = runtime.readText(userPolicyPath(runtime.homeDir()));
  if (!userText.ok) return project;
  const user = parseUserPolicy(userText.value);
  return { ...project, userGuards: user.userGuards, issues: [...project.issues, ...user.issues] };
};

export const loadPolicy = (runtime: PolicyRuntime, root: AbsolutePath): Policy =>
  withEvolved(runtime, root, loadBasePolicy(runtime, root));
