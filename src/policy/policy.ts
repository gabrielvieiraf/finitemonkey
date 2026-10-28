import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, configMap, parseConfigYaml } from "../git/project-config.js";

export const POLICY_FILE = ".finitemonkey/policy.yml";
export const GUARD_MODES = ["off", "shadow", "active"] as const;
export const LEVELS = ["light", "standard", "strict"] as const;
export const SEVERITIES = ["low", "medium", "high"] as const;
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
] as const;
export const DAMAGE_GUARDS = ["secrets", "gate", "git", "rules"] as const;
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
]);

export type GuardMode = (typeof GUARD_MODES)[number];
export type Level = (typeof LEVELS)[number];
export type Severity = (typeof SEVERITIES)[number];

export interface Policy {
  readonly exists: boolean;
  readonly level: Level;
  readonly severity: Severity;
  readonly promoteAfter: number;
  readonly guards: Readonly<Record<string, GuardMode>>;
  readonly experiments: Readonly<Record<string, "random">>;
}

export const DEFAULT_POLICY: Policy = {
  exists: false,
  level: "standard",
  severity: "medium",
  promoteAfter: DEFAULT_PROMOTE_AFTER,
  guards: {},
  experiments: {},
};

const pick = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.find((option) => option === value) ?? fallback;

export const parsePolicy = (text: string): Policy => {
  const tree = parseConfigYaml(text);
  const raw = configAt(tree, "promoteAfter");
  const promoteAfter = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  const guards = Object.fromEntries(
    Object.entries(configMap(tree, "guards")).flatMap(([id, mode]): [string, GuardMode][] => {
      const known = GUARD_MODES.find((option) => option === mode);
      return known === undefined ? [] : [[id, known]];
    }),
  );
  const experiments = Object.fromEntries(
    Object.entries(configMap(tree, "experiments")).flatMap(([id, mode]): [string, "random"][] =>
      mode === "random" ? [[id, "random"]] : [],
    ),
  );
  return {
    exists: true,
    level: pick(LEVELS, configAt(tree, "level"), DEFAULT_POLICY.level),
    severity: pick(SEVERITIES, configAt(tree, "severity"), DEFAULT_POLICY.severity),
    promoteAfter: Number.isInteger(promoteAfter) && promoteAfter > 0 ? promoteAfter : DEFAULT_PROMOTE_AFTER,
    guards,
    experiments,
  };
};

export const policyPath = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(root, POLICY_FILE));

export const loadPolicy = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): Policy => {
  const text = runtime.readText(policyPath(root));
  return text.ok ? parsePolicy(text.value) : DEFAULT_POLICY;
};
