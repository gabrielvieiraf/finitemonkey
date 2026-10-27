import type { Ctx } from "../core/context.js";
import type { Problem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { checkCost, COST_SCHEMA } from "../cost/check.js";
import { costScript } from "../cost/template.js";
import { ExitCode } from "../exit-codes.js";
import { nextNumber, PLAN_DIR, planDir, planFiles, planPath } from "../plan/folder.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

type Root = NonNullable<ReturnType<typeof repoOf>>["root"];

const inRepo = (ctx: Ctx, run: (root: Root) => CommandResult): Promise<CommandResult> => {
  const repo = repoOf(ctx);
  return Promise.resolve(repo === undefined ? failureFrom(ctx.t, notRepository(ctx.cwd)) : run(repo.root));
};

const writeProblem = (detail: string): Problem => ({
  code: "plan_write_failed",
  messageKey: "plan.error.write",
  params: { detail },
  fix: "check that docs/plan can be written",
  exitCode: ExitCode.CheckFailed,
});

const initModel = (ctx: Ctx, root: Root, topic: string): CommandResult => {
  const name = `${nextNumber(planFiles(ctx.runtime, root))}-cost-model.mjs`;
  const made = ctx.runtime.mkdir(planDir(root));
  const script = costScript(ctx.t, topic, ctx.runtime.now().slice(0, 10));
  const written = made.ok ? ctx.runtime.writeText(planPath(root, name), script) : made;
  if (!written.ok) return failureFrom(ctx.t, writeProblem(written.error));
  const file = `${PLAN_DIR}/${name}`;
  return { ...success({ schema: COST_SCHEMA, file, topic }, [ctx.t("cost.created", { file })]), next: `node ${file}` };
};

export const costInitCommand: CommandSpec = {
  path: ["cost", "init"],
  summaryKey: "command.cost_init.summary",
  usage: "finitemonkey cost init [<topic>]",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => {
    const topic = args.positionals[0]?.trim() ?? "";
    return inRepo(ctx, (root) => initModel(ctx, root, topic === "" ? "cost" : topic));
  },
};

export const costCheckCommand: CommandSpec = {
  path: ["cost", "check"],
  summaryKey: "command.cost_check.summary",
  usage: "finitemonkey cost check",
  status: "ready",
  run: (ctx) =>
    inRepo(ctx, (root) => {
      const checked = checkCost(ctx.runtime, root);
      const data = { schema: COST_SCHEMA, ...checked };
      if (checked.issues.length === 0)
        return success(data, [ctx.t("cost.clean", { count: checked.files, days: checked.validityDays })]);
      return failureFrom(
        ctx.t,
        {
          code: "cost_check_failed",
          messageKey: "cost.error.check",
          params: { count: checked.issues.length },
          fix: "add the source and date of each FACT row, refresh expired prices, then rerun the cost model script",
          exitCode: ExitCode.CheckFailed,
          data,
        },
        checked.issues.map(
          (item) =>
            `  ${item.file}:${String(item.line)} ${ctx.t(`cost.issue.${item.kind}`, { detail: item.detail, days: checked.validityDays })}`,
        ),
      );
    }),
};
