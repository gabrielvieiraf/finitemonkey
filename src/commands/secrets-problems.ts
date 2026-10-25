import type { Problem } from "../core/problem.js";
import { ExitCode } from "../exit-codes.js";
import { BASELINE_FILE } from "../secrets/baseline.js";

export const baselineInvalid = (detail: string): Problem => ({
  code: "secrets_baseline_invalid",
  messageKey: "secrets.error.baseline_invalid",
  params: { file: BASELINE_FILE, detail },
  fix: `git checkout -- ${BASELINE_FILE}`,
  exitCode: ExitCode.NotConfigured,
});

export const writeFailed = (file: string, detail: string): Problem => ({
  code: "secrets_write_failed",
  messageKey: "secrets.error.write_failed",
  params: { file, detail },
  fix: "finitemonkey doctor",
  exitCode: ExitCode.Internal,
});

export const gitUnavailable = (detail: string): Problem => ({
  code: "secrets_git_unavailable",
  messageKey: "secrets.error.git_unavailable",
  params: { detail },
  fix: "finitemonkey doctor",
  exitCode: ExitCode.NotConfigured,
});
