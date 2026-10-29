import { configAt, configMap, type ConfigTree, parseConfigYaml } from "../git/project-config.js";
import { ALERT_BUDGET_KEYS, parseAlertBudget } from "./budget.js";
import { issue } from "./issue.js";
import {
  DEFAULT_POLICY,
  DEFAULT_PROMOTE_AFTER,
  GUARD_MODES,
  type GuardMode,
  KNOWN_GUARDS,
  LEVELS,
  type Policy,
  POLICY_FILE,
  POLICY_KEYS,
  type PolicyIssue,
  RETIRED_POLICY_KEYS,
  USER_POLICY_FILE,
} from "./policy.js";
import { parseStage6, sectionKeyIssues } from "./stage6.js";

const pick = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.find((option) => option === value) ?? fallback;

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
    ...parseStage6(tree),
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
