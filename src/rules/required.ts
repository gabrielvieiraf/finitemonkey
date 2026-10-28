import type { AbsolutePath } from "../core/brand.js";
import { isRecord, parseJson } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { CI_JOB } from "./outputs.js";

export type CiRequirement = "required" | "not required" | "unknown";

const GH_TIMEOUT_MS = 10_000;

const defaultBranch = (runtime: Pick<Runtime, "git">, root: AbsolutePath): string => {
  const head = runtime.git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], root);
  const name = head.ok ? head.stdout.trim().replace(/^origin\//, "") : "";
  return name === "" ? "main" : name;
};

const requiredContexts = (rules: unknown): readonly string[] =>
  Array.isArray(rules)
    ? rules.flatMap((rule: unknown) => {
        if (!isRecord(rule) || rule["type"] !== "required_status_checks") return [];
        const parameters = rule["parameters"];
        const checks = isRecord(parameters) ? parameters["required_status_checks"] : undefined;
        return Array.isArray(checks)
          ? checks.flatMap((check: unknown) =>
              isRecord(check) && typeof check["context"] === "string" ? [check["context"]] : [],
            )
          : [];
      })
    : [];

export const ciRequirement = (runtime: Pick<Runtime, "git" | "exec">, root: AbsolutePath): CiRequirement => {
  const branch = defaultBranch(runtime, root);
  const result = runtime.exec({
    command: "gh",
    args: ["api", `repos/{owner}/{repo}/rules/branches/${branch}`],
    cwd: root,
    timeoutMs: GH_TIMEOUT_MS,
  });
  if (!result.found || result.exitCode !== 0) return "unknown";
  const parsed = parseJson(result.stdout);
  if (!parsed.ok) return "unknown";
  return requiredContexts(parsed.value).includes(CI_JOB) ? "required" : "not required";
};
