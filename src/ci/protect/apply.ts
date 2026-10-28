import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../../core/brand.js";
import type { Runtime } from "../../core/runtime.js";
import type { GitLevel } from "../../profile/level.js";
import { type ProtectChange, type ProtectSetting, rulesetFor } from "./plan.js";
import { gh, type GithubSettings } from "./state.js";

export const PROTECT_LOG = ".finitemonkey/ci-protect.jsonl";

export interface AppliedChange extends ProtectChange {
  readonly ok: boolean;
}

type ApplyRuntime = Pick<Runtime, "exec" | "appendText" | "mkdir" | "now">;

const securityBody = (setting: ProtectSetting): string =>
  JSON.stringify({
    security_and_analysis: {
      [setting === "secret-scanning" ? "secret_scanning" : "secret_scanning_push_protection"]: { status: "enabled" },
    },
  });

const call = (
  runtime: ApplyRuntime,
  root: AbsolutePath,
  settings: GithubSettings,
  level: GitLevel,
  setting: ProtectSetting,
): boolean => {
  const repo = settings.repo;
  if (setting === "ruleset") {
    const body = JSON.stringify(rulesetFor(level));
    const args =
      settings.ruleset === null
        ? ["api", "--method", "POST", `repos/${repo}/rulesets`, "--input", "-"]
        : ["api", "--method", "PUT", `repos/${repo}/rulesets/${String(settings.ruleset.id)}`, "--input", "-"];
    return gh(runtime, root, args, body).exitCode === 0;
  }
  if (setting === "dependabot-alerts")
    return gh(runtime, root, ["api", "--method", "PUT", `repos/${repo}/vulnerability-alerts`]).exitCode === 0;
  return (
    gh(runtime, root, ["api", "--method", "PATCH", `repos/${repo}`, "--input", "-"], securityBody(setting)).exitCode ===
    0
  );
};

export const applyChanges = (
  runtime: ApplyRuntime,
  root: AbsolutePath,
  settings: GithubSettings,
  level: GitLevel,
  changes: readonly ProtectChange[],
): readonly AppliedChange[] => {
  runtime.mkdir(toAbsolutePath(join(root, ".finitemonkey")));
  return changes.map((change) => {
    const ok = call(runtime, root, settings, level, change.setting);
    runtime.appendText(
      toAbsolutePath(join(root, ...PROTECT_LOG.split("/"))),
      `${JSON.stringify({ at: runtime.now(), repo: settings.repo, ...change, ok })}\n`,
    );
    return { ...change, ok };
  });
};
