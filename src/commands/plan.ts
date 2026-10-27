import type { Ctx } from "../core/context.js";
import type { Problem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { checkPlan, type PlanCheck } from "../plan/check.js";
import { initPlan, masterDiff, startConsolidation } from "../plan/master.js";
import type { PlanIssue } from "../plan/rules.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const PLAN_SCHEMA = "finitemonkey/plan@1";

const writeProblem = (detail: string): Problem => ({
  code: "plan_write_failed",
  messageKey: "plan.error.write",
  params: { detail },
  fix: "check that docs/plan can be written",
  exitCode: ExitCode.CheckFailed,
});

export const issueLine = (ctx: Pick<Ctx, "t">, item: PlanIssue): string =>
  `${item.file}:${String(item.line)} ${ctx.t(`plan.issue.${item.kind}`, { detail: item.detail })}`;

const checkResult = (ctx: Ctx, check: PlanCheck, before: readonly string[] = []): CommandResult => {
  const data = { schema: PLAN_SCHEMA, ...check };
  if (check.issues.length === 0) return success(data, [...before, ctx.t("plan.clean", { count: check.reports })]);
  return failureFrom(
    ctx.t,
    {
      code: "plan_check_failed",
      messageKey: "plan.error.check",
      params: { count: check.issues.length },
      fix: "fix each line listed, then run finitemonkey plan check again",
      exitCode: ExitCode.CheckFailed,
      data,
    },
    [...before, ...check.issues.map((item) => `  ${issueLine(ctx, item)}`)],
  );
};

const inRepo = (ctx: Ctx, run: (root: Parameters<typeof checkPlan>[1]) => CommandResult): Promise<CommandResult> => {
  const repo = repoOf(ctx);
  return Promise.resolve(repo === undefined ? failureFrom(ctx.t, notRepository(ctx.cwd)) : run(repo.root));
};

export const planInitCommand: CommandSpec = {
  path: ["plan", "init"],
  summaryKey: "command.plan_init.summary",
  usage: "finitemonkey plan init",
  status: "ready",
  run: (ctx) =>
    inRepo(ctx, (root) => {
      const made = initPlan(ctx.runtime, ctx.t, root);
      if (!made.ok) return failureFrom(ctx.t, writeProblem(made.error));
      const key = made.value.created ? "plan.created" : "plan.exists";
      return success({ schema: PLAN_SCHEMA, ...made.value }, [ctx.t(key, { file: made.value.file })]);
    }),
};

export const planCheckCommand: CommandSpec = {
  path: ["plan", "check"],
  summaryKey: "command.plan_check.summary",
  usage: "finitemonkey plan check",
  status: "ready",
  run: (ctx) => inRepo(ctx, (root) => checkResult(ctx, checkPlan(ctx.runtime, root))),
};

const finishConsolidation = (ctx: Ctx, root: Parameters<typeof checkPlan>[1]): CommandResult => {
  const { previous, diff } = masterDiff(ctx.runtime, root);
  const head =
    previous === undefined ? [] : [ctx.t("plan.consolidate.diff", { file: previous }), ...diff.trimEnd().split("\n")];
  return checkResult(ctx, checkPlan(ctx.runtime, root), head);
};

export const planConsolidateCommand: CommandSpec = {
  path: ["plan", "consolidate"],
  summaryKey: "command.plan_consolidate.summary",
  usage: "finitemonkey plan consolidate [--done]",
  status: "ready",
  options: { done: { type: "boolean" } },
  run: (ctx, args) =>
    inRepo(ctx, (root) => {
      if (args.values["done"] === true) return finishConsolidation(ctx, root);
      const started = startConsolidation(ctx.runtime, root, ctx.runtime.now().slice(0, 10));
      if (!started.ok && started.error === "no_master")
        return failureFrom(ctx.t, {
          ...writeProblem("docs/plan/MASTER.md"),
          code: "plan_check_failed",
          messageKey: "plan.error.no_master",
          fix: "finitemonkey plan init",
        });
      if (!started.ok) return failureFrom(ctx.t, writeProblem(started.error));
      const { previous, reports } = started.value;
      return {
        ...success({ schema: PLAN_SCHEMA, ...started.value }, [
          ctx.t("plan.consolidate.saved", { file: previous }),
          ctx.t("plan.consolidate.ask", { count: reports.length }),
          ...reports.flatMap((report) => [
            `## ${report.file}`,
            report.text === "" ? ctx.t("plan.consolidate.no_text") : report.text,
          ]),
        ]),
        next: "finitemonkey plan consolidate --done",
      };
    }),
};
