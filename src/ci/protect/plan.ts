import { isRecord } from "../../core/parsed.js";
import { REQUIRED_CHECK } from "../../github/ruleset.js";
import type { GitLevel } from "../../profile/level.js";
import { type GithubSettings, PROTECT_RULESET_NAME, type Toggle } from "./state.js";

export const PROTECT_SETTINGS = ["ruleset", "secret-scanning", "push-protection", "dependabot-alerts"] as const;

export type ProtectSetting = (typeof PROTECT_SETTINGS)[number];

export interface ProtectChange {
  readonly setting: ProtectSetting;
  readonly current: string;
  readonly proposed: string;
}

interface Review {
  readonly approvals: number;
  readonly codeOwners: boolean;
}

const REVIEW: Readonly<Record<GitLevel, Review | undefined>> = {
  beginner: { approvals: 1, codeOwners: true },
  intermediate: { approvals: 0, codeOwners: true },
  advanced: undefined,
};

export const rulesetFor = (level: GitLevel): Readonly<Record<string, unknown>> => {
  const review = REVIEW[level];
  return {
    name: PROTECT_RULESET_NAME,
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      ...(review === undefined
        ? []
        : [
            {
              type: "pull_request",
              parameters: {
                required_approving_review_count: review.approvals,
                require_code_owner_review: review.codeOwners,
                dismiss_stale_reviews_on_push: true,
                require_last_push_approval: false,
                required_review_thread_resolution: false,
              },
            },
          ]),
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: [{ context: REQUIRED_CHECK }],
        },
      },
    ],
  };
};

const ruleSummary = (rule: unknown): string => {
  if (!isRecord(rule) || typeof rule["type"] !== "string") return "?";
  const parameters = isRecord(rule["parameters"]) ? rule["parameters"] : {};
  if (rule["type"] === "pull_request") {
    const approvals = parameters["required_approving_review_count"];
    const owners = parameters["require_code_owner_review"] === true ? ", code owners" : "";
    return `pull_request (${String(typeof approvals === "number" ? approvals : 0)} approvals${owners})`;
  }
  if (rule["type"] === "required_status_checks") {
    const checks = Array.isArray(parameters["required_status_checks"]) ? parameters["required_status_checks"] : [];
    const names = checks.map((check: unknown) => (isRecord(check) ? String(check["context"]) : "?"));
    return `required_status_checks (${names.join(", ")})`;
  }
  return rule["type"];
};

export const rulesSummary = (rules: readonly unknown[] | undefined): string =>
  rules === undefined || rules.length === 0 ? "none" : rules.map(ruleSummary).join("; ");

const toggleChange = (setting: ProtectSetting, current: Toggle): readonly ProtectChange[] =>
  current === "enabled" ? [] : [{ setting, current, proposed: "enabled" }];

export const protectChanges = (settings: GithubSettings, level: GitLevel): readonly ProtectChange[] => {
  const proposedRules = rulesetFor(level)["rules"];
  const proposed = rulesSummary(Array.isArray(proposedRules) ? proposedRules : []);
  const current = rulesSummary(settings.ruleset?.rules);
  return [
    ...(current === proposed ? [] : [{ setting: "ruleset" as const, current, proposed }]),
    ...toggleChange("secret-scanning", settings.secretScanning),
    ...toggleChange("push-protection", settings.pushProtection),
    ...toggleChange("dependabot-alerts", settings.dependabotAlerts),
  ];
};
