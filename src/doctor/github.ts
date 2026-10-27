import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { isProtectedOnGithub, readCache } from "../github/ruleset.js";
import { type Check, type CheckFinding, type DoctorEnv, finding } from "./types.js";

const CODEOWNERS_FILES = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"] as const;
export const CODEOWNERS_MAX_BYTES = 3 * 1024 * 1024;
const OWNER = /^(@[\w.-]+(\/[\w.-]+)?|[^@\s]+@[^@\s]+\.[^@\s]+)$/;

const rulesetFindings = (env: DoctorEnv): readonly CheckFinding[] => {
  const state = readCache(env.runtime, env.root);
  if (state === undefined) return [];
  if (!isProtectedOnGithub(state)) {
    return [
      finding(
        "github-ruleset",
        "warn",
        "doctor.github.no_ruleset",
        { branch: state.defaultBranch },
        "doctor.github.fix_ruleset",
      ),
    ];
  }
  return [finding("github-ruleset", "ok", "doctor.github.ruleset_ok", { branch: state.defaultBranch })];
};

const workflowsWithoutMergeGroup = (env: DoctorEnv): readonly string[] => {
  const dir = toAbsolutePath(join(env.root, ".github", "workflows"));
  const names = env.runtime.listDir(dir);
  if (!names.ok) return [];
  return names.value.filter((name) => {
    if (!/\.ya?ml$/.test(name)) return false;
    const text = env.runtime.readText(toAbsolutePath(join(dir, name)));
    return text.ok && /\bpull_request\b/.test(text.value) && !/\bmerge_group\b/.test(text.value);
  });
};

const queueFindings = (env: DoctorEnv): readonly CheckFinding[] => {
  const state = readCache(env.runtime, env.root);
  if (state?.mergeQueue !== true) return [];
  const missing = workflowsWithoutMergeGroup(env);
  return missing.length === 0
    ? []
    : [
        finding(
          "merge-queue",
          "fail",
          "doctor.github.queue_without_merge_group",
          { files: missing.join(", ") },
          "doctor.github.fix_merge_group",
        ),
      ];
};

export const invalidCodeownersLines = (text: string): readonly number[] =>
  text.split("\n").flatMap((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return [];
    const [pattern = "", ...owners] = line.replace(/\s+#.*$/, "").split(/\s+/);
    const bad = pattern.startsWith("!") || pattern.includes("[") || owners.some((owner) => !OWNER.test(owner));
    return bad ? [index + 1] : [];
  });

const codeownersFindings = (env: DoctorEnv): readonly CheckFinding[] => {
  const file = CODEOWNERS_FILES.find((name) => env.runtime.readText(toAbsolutePath(join(env.root, name))).ok);
  if (file === undefined) return [];
  const text = env.runtime.readText(toAbsolutePath(join(env.root, file)));
  if (!text.ok) return [];
  if (Buffer.byteLength(text.value, "utf8") > CODEOWNERS_MAX_BYTES) {
    return [finding("codeowners", "fail", "doctor.github.codeowners_size", { file }, "doctor.github.fix_codeowners")];
  }
  const invalid = invalidCodeownersLines(text.value);
  return invalid.length === 0
    ? [finding("codeowners", "ok", "doctor.github.codeowners_ok", { file })]
    : [
        finding(
          "codeowners",
          "fail",
          "doctor.github.codeowners_invalid",
          { file, lines: invalid.join(", ") },
          "doctor.github.fix_codeowners",
        ),
      ];
};

export const checkGithubRules: Check = (env) => [
  ...rulesetFindings(env),
  ...queueFindings(env),
  ...codeownersFindings(env),
];
