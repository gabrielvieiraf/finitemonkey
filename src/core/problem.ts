import { ExitCode, type FailureExitCode } from "../exit-codes.js";
import type { MessageKey } from "../i18n/catalogs.js";
import type { Params } from "../i18n/translate.js";

export const ERROR_CODES = [
  "doctor_failed",
  "hook_blocked",
  "i18n_catalog_unreadable",
  "i18n_mismatch",
  "internal_error",
  "invalid_arguments",
  "invalid_lang",
  "needs_confirmation",
  "not_implemented",
  "unexpected_argument",
  "unknown_command",
  "unknown_hook_event",
  "secrets_found",
  "secrets_git_unavailable",
  "secrets_baseline_invalid",
  "secrets_finding_not_found",
  "secrets_incident_not_found",
  "secrets_not_rotated",
  "secrets_write_failed",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface Problem<TData = never> {
  readonly code: ErrorCode;
  readonly messageKey: MessageKey;
  readonly params: Params;
  readonly fix: string;
  readonly exitCode: FailureExitCode;
  readonly data?: TData;
}

export const usageProblem = (code: ErrorCode, messageKey: MessageKey, fix: string, params: Params = {}): Problem => ({
  code,
  messageKey,
  params,
  fix,
  exitCode: ExitCode.Usage,
});

export const needsPersonProblem = (messageKey: MessageKey, fix: string, params: Params = {}): Problem => ({
  code: "needs_confirmation",
  messageKey,
  params,
  fix,
  exitCode: ExitCode.NeedsPerson,
});

export class FmError extends Error {
  readonly problem: Problem<unknown>;

  constructor(problem: Problem<unknown>) {
    super(problem.code);
    this.name = "FmError";
    this.problem = problem;
  }
}
