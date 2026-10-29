import { nowMs } from "../core/clock.js";
import { classRates, readBudget } from "../policy/budget.js";
import { isPolicyError, loadPolicy, POLICY_FILE, type PolicyIssue } from "../policy/policy.js";
import { fmPaths } from "../task/paths.js";
import { type Check, finding } from "./types.js";

const named = (found: PolicyIssue): string =>
  found.suggestion === undefined ? found.key : `${found.key} → ${found.suggestion}`;

export const checkPolicy: Check = ({ root, runtime }) => {
  const policy = loadPolicy(runtime, root);
  if (policy.issues.length === 0) {
    return policy.exists ? [finding("policy.valid", "ok", "doctor.policy.ok", { file: POLICY_FILE })] : [];
  }
  const files = [...new Set(policy.issues.map((found) => found.file))].join(", ");
  const status = policy.issues.some(isPolicyError) ? "fail" : "warn";
  const detail = policy.issues.map(named).join(", ");
  return [finding("policy.valid", status, "doctor.policy.issues", { file: files, detail }, "doctor.policy.fix")];
};

export const checkAlertBudget: Check = ({ root, runtime }) => {
  const policy = loadPolicy(runtime, root);
  const rates = classRates(readBudget(runtime, fmPaths(root)), policy.alertBudget, nowMs(runtime));
  const silenced = rates.filter((rate) => rate.muted);
  if (silenced.length === 0) return [];
  const list = silenced.map((rate) => `${rate.guard} (${String(rate.dismissed)}/${String(rate.fired)})`).join(", ");
  return [
    finding(
      "policy.alert_budget",
      "warn",
      "doctor.alert_budget.muted",
      { list, limit: Math.round(policy.alertBudget.muteAbove * 100), days: policy.alertBudget.windowDays },
      "doctor.alert_budget.fix",
    ),
  ];
};
