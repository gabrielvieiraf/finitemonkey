import type { Ctx } from "../core/context.js";
import type { Probe, ProbeResult } from "../core/runtime.js";
import { findGitRoot } from "../install/project.js";
import { checkBriefing } from "./briefing.js";
import { checkClaudeSettings } from "./claude-settings.js";
import { checkCoexistence } from "./coexistence.js";
import { checkEnvHygiene } from "./env-hygiene.js";
import { checkAuthVariables, checkPathCopies, checkSandbox } from "./environment.js";
import { checkGithubRules } from "./github.js";
import { checkGithubSettings } from "./github-settings.js";
import { checkHiddenText } from "./hidden-text.js";
import { checkHooks } from "./hooks.js";
import { checkInstructionDrift } from "./instruction-drift.js";
import { checkInstructionLayers } from "./instruction-layers.js";
import { checkInstructions } from "./instructions.js";
import { checkLineEndings } from "./line-endings.js";
import { checkAgentsFile } from "./memory.js";
import { checkMods } from "./mods.js";
import { checkAlertBudget, checkPolicy } from "./policy.js";
import { checkProjectFiles } from "./project-files.js";
import { checkRemoteCredentials } from "./remotes.js";
import { checkRewriters } from "./rewriters.js";
import { checkRules } from "./rules.js";
import { checkSupplyChain } from "./supply-chain.js";
import { checkOs, checkPath } from "./system.js";
import { checkClaude, checkGit, checkNode } from "./tools.js";
import type { Check, CheckFinding, CheckStatus, DoctorEnv, HookHealth } from "./types.js";

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
  checkLineEndings,
  checkRemoteCredentials,
  checkGithubRules,
  checkBriefing,
  checkAgentsFile,
  checkRewriters,
  checkEnvHygiene,
  checkSupplyChain,
  checkCoexistence,
  checkRules,
  checkHooks,
  checkInstructionLayers,
  checkGithubSettings,
  checkPolicy,
  checkAlertBudget,
  checkHiddenText,
  checkMods,
  checkInstructionDrift,
];

export interface DoctorItem {
  readonly check: string;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly fix?: string;
}

export interface HookItem {
  readonly check: string;
  readonly status: HookHealth;
  readonly fix: string | null;
}

export interface DoctorReport {
  readonly schema: typeof DOCTOR_SCHEMA;
  readonly checks: readonly DoctorItem[];
  readonly hooks: readonly HookItem[];
  readonly summary: Readonly<Record<CheckStatus, number>>;
}

const probeOnce = (probe: Probe): Probe => {
  const seen = new Map<string, ProbeResult>();
  return (command, args, timeoutMs) => {
    const key = [command, ...args].join(" ");
    const known = seen.get(key) ?? probe(command, args, timeoutMs);
    seen.set(key, known);
    return known;
  };
};

export const doctorEnvFrom = (ctx: Ctx): DoctorEnv => ({
  platform: ctx.platform,
  env: ctx.env,
  cwd: ctx.cwd,
  root: findGitRoot(ctx.cwd, ctx.runtime) ?? ctx.cwd,
  version: ctx.version,
  runtime: { ...ctx.runtime, probe: probeOnce(ctx.runtime.probe) },
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

const hookItems = (ctx: Pick<Ctx, "t">, findings: readonly CheckFinding[]): readonly HookItem[] =>
  findings.flatMap((finding) =>
    finding.hook === undefined
      ? []
      : [
          {
            check: finding.check,
            status: finding.hook,
            fix: finding.fixKey === undefined ? null : ctx.t(finding.fixKey, finding.params),
          },
        ],
  );

export const buildReport = (ctx: Pick<Ctx, "t">, findings: readonly CheckFinding[]): DoctorReport => {
  const checks = findings.map((finding) => toItem(ctx, finding));
  return {
    schema: DOCTOR_SCHEMA,
    checks,
    hooks: hookItems(ctx, findings),
    summary: { ok: count(checks, "ok"), warn: count(checks, "warn"), fail: count(checks, "fail") },
  };
};
