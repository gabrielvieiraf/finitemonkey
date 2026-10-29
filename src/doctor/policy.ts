import { isPolicyError, loadPolicy, POLICY_FILE, type PolicyIssue } from "../policy/policy.js";
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
