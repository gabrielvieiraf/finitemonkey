import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, parseConfigYaml } from "../git/project-config.js";

export const GIT_LEVELS = ["beginner", "intermediate", "advanced"] as const;

export type GitLevel = (typeof GIT_LEVELS)[number];

export const DEFAULT_GIT_LEVEL: GitLevel = "intermediate";

export const PROFILE_FILE = ".finitemonkey/profile.yml";

export const INFRA_DOMAIN = "infrastructure";

export interface LevelRules {
  readonly mergeDefault: "never" | "pr-auto" | "pr-or-fast-forward";
  readonly resolvesOwnBranchOnly: boolean;
  readonly c6c7: "report" | "propose";
  readonly leaseOwnBranch: "ask" | "allow";
  readonly cleanup: "archive" | "plan" | "contained-auto";
  readonly update: "merge" | "merge-or-rebase" | "any";
  readonly frontDelivery: "apply" | "commit";
}

export const LEVEL_RULES: Readonly<Record<GitLevel, LevelRules>> = {
  beginner: {
    mergeDefault: "never",
    resolvesOwnBranchOnly: true,
    c6c7: "report",
    leaseOwnBranch: "ask",
    cleanup: "archive",
    update: "merge",
    frontDelivery: "apply",
  },
  intermediate: {
    mergeDefault: "pr-auto",
    resolvesOwnBranchOnly: false,
    c6c7: "report",
    leaseOwnBranch: "allow",
    cleanup: "plan",
    update: "merge-or-rebase",
    frontDelivery: "commit",
  },
  advanced: {
    mergeDefault: "pr-or-fast-forward",
    resolvesOwnBranchOnly: false,
    c6c7: "propose",
    leaseOwnBranch: "allow",
    cleanup: "contained-auto",
    update: "any",
    frontDelivery: "commit",
  },
};

const levelIn = (runtime: Runtime, path: AbsolutePath): GitLevel | undefined => {
  const text = runtime.readText(path);
  if (!text.ok) return undefined;
  const value = configAt(parseConfigYaml(text.value), "domains", INFRA_DOMAIN);
  return GIT_LEVELS.find((level) => level === value);
};

export const gitLevel = (runtime: Runtime, root: AbsolutePath): GitLevel =>
  levelIn(runtime, toAbsolutePath(join(root, PROFILE_FILE))) ??
  levelIn(runtime, toAbsolutePath(join(runtime.homeDir(), PROFILE_FILE))) ??
  DEFAULT_GIT_LEVEL;

export const levelRules = (runtime: Runtime, root: AbsolutePath): LevelRules => LEVEL_RULES[gitLevel(runtime, root)];
