import { bucketCounts, ruleCoverage } from "../rules/coverage.js";
import { readManifest } from "../rules/manifest.js";
import { CI_JOB } from "../rules/outputs.js";
import { coverageRules } from "../rules/preset.js";
import { DETERMINISTIC_CEILING } from "../rules/propose.js";
import { ciRequirement } from "../rules/required.js";
import { type Check, type CheckFinding, finding } from "./types.js";

export const checkRules: Check = ({ root, runtime }) => {
  const rules = coverageRules(runtime, root);
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
  const enforced = bucketCounts(rules.value).enforced;
  const many =
    enforced > DETERMINISTIC_CEILING
      ? [
          finding(
            "rules.enforced_count",
            "warn",
            "rules.coverage.too_many",
            { count: enforced, max: DETERMINISTIC_CEILING },
            "rules.doctor.fix_too_many",
          ),
        ]
      : [];
  return [...coverage, ...ci, ...many];
};
