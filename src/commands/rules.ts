import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { baseExists, ciBase } from "../githooks/ci.js";
import { checksResult } from "../githooks/render.js";
import { ciRuleCheck } from "../rules/checks.js";
import { compileRules } from "../rules/compile.js";
import { type RuleCoverage, ruleCoverage } from "../rules/coverage.js";
import { type SURFACES } from "../rules/manifest.js";
import { loadRules, type ProjectRule, RULES_FILE } from "../rules/types.js";
import { projectRoot } from "../secrets/project.js";
import { gitProblem, notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const RULES_COVERAGE_SCHEMA = "finitemonkey/rules-coverage@1";
export const RULES_COMPILE_SCHEMA = "finitemonkey/rules-compile@1";
export const RULES_CHECK_SCHEMA = "finitemonkey/rules-check@1";

export interface RulesCoverageData {
  readonly schema: typeof RULES_COVERAGE_SCHEMA;
  readonly rules: readonly RuleCoverage[];
}

const invalid = (ctx: Ctx, detail: string): CommandResult =>
  failureFrom(
    ctx.t,
    usageProblem("invalid_arguments", "rules.error.invalid", `edit ${RULES_FILE}`, { file: RULES_FILE, detail }),
  );

const withRules = (ctx: Ctx, run: (rules: readonly ProjectRule[]) => CommandResult): CommandResult => {
  const rules = loadRules(ctx.runtime, projectRoot(ctx));
  return rules.ok ? run(rules.value) : invalid(ctx, rules.error);
};

const cell = (item: RuleCoverage, surface: (typeof SURFACES)[number]): string => {
  if (item.surfaces.includes(surface)) return "yes";
  return item.applicable.includes(surface) ? "no" : "-";
};

const coverageLine = (ctx: Ctx, item: RuleCoverage): string =>
  ctx.t(
    item.status === "text only" && item.severity === "never" ? "rules.coverage.text_only_never" : "rules.coverage.row",
    {
      id: item.id,
      severity: item.severity,
      status: item.status,
      guard: cell(item, "guard"),
      config: cell(item, "config"),
      git: cell(item, "git"),
      ci: cell(item, "ci"),
    },
  );

export const rulesCoverageCommand: CommandSpec = {
  path: ["rules", "coverage"],
  summaryKey: "rules.command.coverage",
  usage: "finitemonkey rules coverage",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) =>
    Promise.resolve(
      withRules(ctx, (rules) => {
        const items = ruleCoverage(ctx.runtime, projectRoot(ctx), rules);
        const data: RulesCoverageData = { schema: RULES_COVERAGE_SCHEMA, rules: items };
        const human =
          items.length === 0
            ? [ctx.t("rules.coverage.empty", { file: RULES_FILE })]
            : items.map((item) => coverageLine(ctx, item));
        const uncovered = items.filter((item) => item.severity === "never" && !item.covered).length;
        if (uncovered === 0) return success(data, human);
        return failureFrom(
          ctx.t,
          {
            code: "rules_uncovered",
            messageKey: "rules.coverage.uncovered",
            params: { count: uncovered },
            fix: "finitemonkey rules compile --ci",
            exitCode: ExitCode.CheckFailed,
            data,
          },
          human,
        );
      }),
    ),
};

export const rulesCompileCommand: CommandSpec = {
  path: ["rules", "compile"],
  summaryKey: "rules.command.compile",
  usage: "finitemonkey rules compile [--ci]",
  status: "ready",
  maxPositionals: 0,
  options: { ci: { type: "boolean" } },
  run: (ctx, args) =>
    Promise.resolve(
      withRules(ctx, (rules) => {
        const root = projectRoot(ctx);
        const compiled = compileRules(ctx.runtime, root, rules, {
          ci: args.values["ci"] === true,
          version: ctx.version,
        });
        if (!compiled.ok)
          return failureFrom(ctx.t, {
            code: "rules_write_failed",
            messageKey: "rules.error.write_failed",
            params: { detail: compiled.error },
            fix: "finitemonkey doctor",
            exitCode: ExitCode.Internal,
          });
        const data = {
          schema: RULES_COMPILE_SCHEMA,
          written: compiled.value.written,
          rules: compiled.value.manifest.rules,
        };
        const never = rules.some((rule) => rule.severity === "never");
        return success(data, [
          ctx.t("rules.compile.done", { count: rules.length, files: compiled.value.written.join(", ") }),
          ...(never && compiled.value.manifest.workflow === undefined ? [ctx.t("rules.compile.ci_missing")] : []),
        ]);
      }),
    ),
};

export const rulesCheckCommand: CommandSpec = {
  path: ["rules", "check"],
  summaryKey: "rules.command.check",
  usage: "finitemonkey rules check --ci [--base <ref>]",
  status: "ready",
  maxPositionals: 0,
  options: { ci: { type: "boolean" }, base: { type: "string" } },
  run: (ctx, args) => {
    const repo = repoOf(ctx);
    if (repo === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const given = args.values["base"];
    const base = ciBase(ctx.runtime, repo, ctx.env, typeof given === "string" ? given : undefined);
    if (!baseExists(ctx.runtime, repo, base))
      return Promise.resolve(
        failureFrom(
          ctx.t,
          gitProblem(
            "githook_failed",
            "githooks.error.no_base",
            base,
            `git fetch origin && finitemonkey rules check --ci --base ${base}`,
          ),
        ),
      );
    const check = ciRuleCheck(ctx.runtime, toAbsolutePath(repo.root), ctx.env, base);
    return Promise.resolve(checksResult(ctx.t, RULES_CHECK_SCHEMA, "githook_failed", [check]));
  },
};
