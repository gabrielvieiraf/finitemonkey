import type { Ctx } from "../core/context.js";
import { findGitRoot } from "../install/project.js";
import { checkClaudeSettings } from "./claude-settings.js";
import { checkAuthVariables, checkPathCopies, checkSandbox } from "./environment.js";
import { checkInstructions } from "./instructions.js";
import { checkProjectFiles } from "./project-files.js";
import { checkOs, checkPath } from "./system.js";
import { checkClaude, checkGit, checkNode } from "./tools.js";
import type { Check, CheckFinding, CheckStatus, DoctorEnv } from "./types.js";

export const DOCTOR_SCHEMA = "finitemonkey/doctor@1";

export const CHECKS: readonly Check[] = [
  checkNode,
  checkGit,
  checkClaude,
  checkOs,
  checkPath,
  checkSandbox,
  checkPathCopies,
  checkAuthVariables,
  checkClaudeSettings,
  checkInstructions,
  checkProjectFiles,
];

export interface DoctorItem {
  readonly check: string;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly fix?: string;
}

export interface DoctorReport {
  readonly schema: typeof DOCTOR_SCHEMA;
  readonly checks: readonly DoctorItem[];
  readonly summary: Readonly<Record<CheckStatus, number>>;
}

export const doctorEnvFrom = (ctx: Ctx): DoctorEnv => ({
  platform: ctx.platform,
  env: ctx.env,
  cwd: ctx.cwd,
  root: findGitRoot(ctx.cwd, ctx.runtime) ?? ctx.cwd,
  runtime: ctx.runtime,
});

export const runChecks = (env: DoctorEnv, checks: readonly Check[] = CHECKS): readonly CheckFinding[] =>
  checks.flatMap((check) => check(env));

const toItem = (ctx: Pick<Ctx, "t">, finding: CheckFinding): DoctorItem => ({
  check: finding.check,
  status: finding.status,
  detail: ctx.t(finding.messageKey, finding.params),
  ...(finding.fixKey === undefined ? {} : { fix: ctx.t(finding.fixKey, finding.params) }),
});

const count = (items: readonly DoctorItem[], status: CheckStatus): number =>
  items.filter((item) => item.status === status).length;

export const buildReport = (ctx: Pick<Ctx, "t">, findings: readonly CheckFinding[]): DoctorReport => {
  const checks = findings.map((finding) => toItem(ctx, finding));
  return {
    schema: DOCTOR_SCHEMA,
    checks,
    summary: { ok: count(checks, "ok"), warn: count(checks, "warn"), fail: count(checks, "fail") },
  };
};
