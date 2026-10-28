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
  "secrets_live_unreachable",
  "settings_unreadable",
  "lock_unreadable",
  "install_locked",
  "install_failed",
  "install_permission_denied",
  "not_installed",
  "install_outdated",
  "gate_failed",
  "gate_incomplete",
  "gate_not_run",
  "not_a_git_repo",
  "task_exists",
  "task_invalid",
  "task_not_found",
  "prose_found",
  "prose_no_input",
  "prose_unreadable",
  "git_snapshot_failed",
  "git_nothing_to_undo",
  "git_undo_failed",
  "git_rescue_failed",
  "merge_lost_work",
  "merge_unanalyzable",
  "app_check_failed",
  "githook_failed",
  "ci_gate_failed",
  "look_failed",
  "look_unavailable",
  "critique_must_fix",
  "plan_write_failed",
  "wt_taken",
  "wt_bad_place",
  "wt_failed",
  "map_unavailable",
  "plan_check_failed",
  "wt_not_found",
  "decision_invalid",
  "research_invalid",
  "cost_check_failed",
  "merge_failed",
  "merge_stopped",
  "pr_failed",
  "pr_parent_open",
  "pr_conflict",
  "pr_outside_scope",
  "reconcile_unavailable",
  "parity_check_failed",
  "audit_findings",
  "fronts_refused",
  "fronts_failed",
  "front_report_invalid",
  "fronts_merge_failed",
  "creds_write_failed",
  "deps_check_failed",
  "deps_scanner_missing",
  "deps_scan_failed",
  "deps_vulnerable",
  "deps_write_failed",
  "findings_not_found",
  "appsec_found",
  "rules_uncovered",
  "rules_write_failed",
  "run_failed",
  "gen_write_failed",
  "ownership_failed",
  "ci_audit_failed",
  "ci_protect_failed",
  "ci_watch_failed",
  "ci_watch_pending",
  "deploy_level_needs_decision",
  "deploy_write_failed",
  "deploy_generate_blocked",
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
