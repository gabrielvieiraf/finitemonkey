import type { Ctx } from "../core/context.js";
import { needsPersonProblem, type Problem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { ExitCode } from "../exit-codes.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import type { Translate } from "../i18n/translate.js";
import { explainPolicy, type GuardExplain, type PolicyExplainData } from "../policy/explain.js";
import { readShadow, writeShadow } from "../policy/guards.js";
import { isPolicyError, OPTIONAL_GUARDS, type PolicyIssue } from "../policy/policy.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export interface FalsePositiveData {
  readonly guard: string;
  readonly falsePositives: number;
}

const FIX = `finitemonkey policy false-positive <${OPTIONAL_GUARDS.join("|")}>`;

const recordFalsePositive = (ctx: Ctx, guard: string): CommandResult<FalsePositiveData> => {
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("policy.error.person_only", FIX));
  if (!OPTIONAL_GUARDS.some((id) => id === guard)) {
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "error.invalid_arguments", FIX, { detail: guard }));
  }
  const paths = fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);
  const state = readShadow(ctx.runtime, paths);
  const before = state[guard] ?? { firings: 0, falsePositives: 0, promoted: false };
  const falsePositives = before.falsePositives + 1;
  writeShadow(ctx.runtime, paths, { ...state, [guard]: { ...before, falsePositives } });
  logEvent(ctx.runtime, paths, "guard_false_positive", { guard, falsePositives });
  return success({ guard, falsePositives }, [
    ctx.t("policy.false_positive.recorded", { guard, count: falsePositives }),
  ]);
};

export const policyFalsePositiveCommand: CommandSpec = {
  path: ["policy", "false-positive"],
  summaryKey: "command.policy_false_positive.summary",
  usage: FIX,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => Promise.resolve(recordFalsePositive(ctx, args.positionals[0] ?? "")),
};

export const policyIssueLine = (t: Translate, found: PolicyIssue): string => {
  const base = t(`policy.issue.${found.kind}`, { file: found.file, key: found.key });
  return found.suggestion === undefined ? base : `${base} ${t("policy.issue.suggestion", { name: found.suggestion })}`;
};

const guardLine = (t: Translate, row: GuardExplain): string => {
  const ignored = row.ignored.map((level) => t("policy.explain.ignored", { source: level.source, mode: level.mode }));
  return [
    t("policy.explain.row", { guard: row.guard, mode: row.mode, source: row.source, failure: row.failureMode }),
    ...ignored,
  ].join(" ");
};

const invalidPolicy = (data: PolicyExplainData): Problem<PolicyExplainData> => ({
  code: "policy_invalid",
  messageKey: "policy.error.invalid",
  params: { count: data.errors },
  fix: "fix the keys named above in .finitemonkey/policy.yml, then run `finitemonkey policy explain` again",
  exitCode: ExitCode.Usage,
  data,
});

const explain = (ctx: Ctx): CommandResult<PolicyExplainData> => {
  const paths = fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);
  const data = explainPolicy(ctx.runtime, paths);
  const human = [
    ...data.guards.map((row) => guardLine(ctx.t, row)),
    ...data.issues.map((found) => policyIssueLine(ctx.t, found)),
  ];
  return data.issues.some(isPolicyError) ? failureFrom(ctx.t, invalidPolicy(data), human) : success(data, human);
};

export const policyExplainCommand: CommandSpec = {
  path: ["policy", "explain"],
  summaryKey: "command.policy_explain.summary",
  usage: "finitemonkey policy explain [--json]",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => Promise.resolve(explain(ctx)),
};
