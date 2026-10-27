import { ruleCoverage } from "../rules/coverage.js";
import { readManifest } from "../rules/manifest.js";
import { CI_JOB } from "../rules/outputs.js";
import { ciRequirement } from "../rules/required.js";
import { loadRules } from "../rules/types.js";
import { type Check, type CheckFinding, finding } from "./types.js";

export const checkRules: Check = ({ root, runtime }) => {
  const rules = loadRules(runtime, root);
  if (!rules.ok)
    return [
      finding("rules.file", "fail", "rules.error.invalid", { file: ".finitemonkey/rules.yml", detail: rules.error }),
    ];
  if (rules.value.length === 0) return [];
  const coverage: readonly CheckFinding[] = ruleCoverage(runtime, root, rules.value).flatMap((item) => {
    if (item.covered) return [];
    const params = { id: item.id, status: item.status };
    return [
      finding(
        "rules.coverage",
        item.severity === "never" ? "fail" : "warn",
        "rules.doctor.uncovered",
        params,
        "rules.doctor.fix_compile",
      ),
    ];
  });
  const manifest = readManifest(runtime, root);
  const ci =
    manifest.workflow !== undefined && ciRequirement(runtime, root) === "not required"
      ? [finding("rules.ci", "warn", "rules.doctor.ci_not_required", { job: CI_JOB }, "rules.doctor.fix_ruleset")]
      : [];
  return [...coverage, ...ci];
};
