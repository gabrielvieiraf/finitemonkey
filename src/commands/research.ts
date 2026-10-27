import type { Ctx } from "../core/context.js";
import { type Problem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { nextNumber, numberOf, PLAN_DIR, planDir, planFiles, planPath, slugOf } from "../plan/folder.js";
import { researchRecords } from "../research/check.js";
import { RESEARCH_SCHEMA } from "../research/sections.js";
import { renderResearch } from "../research/template.js";
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

const recordName = (names: readonly string[], topic: string): string => {
  const slug = slugOf(topic);
  const today = names.find((name) => name.endsWith(`-today-${slug}.md`));
  const number = today === undefined ? undefined : numberOf(today);
  const prefix = number === undefined ? nextNumber(names) : String(number).padStart(2, "0");
  return `${prefix}b-state-of-the-art-${slug}.md`;
};

const newRecord = (ctx: Ctx, root: Root, topic: string): CommandResult => {
  const names = planFiles(ctx.runtime, root);
  const name = recordName(names, topic);
  if (names.includes(name))
    return success({ schema: RESEARCH_SCHEMA, file: `${PLAN_DIR}/${name}`, topic, created: false }, [
      ctx.t("plan.exists", { file: `${PLAN_DIR}/${name}` }),
    ]);
  const made = ctx.runtime.mkdir(planDir(root));
  const written = made.ok
    ? ctx.runtime.writeText(planPath(root, name), renderResearch(ctx.t, topic, ctx.runtime.now().slice(0, 10)))
    : made;
  if (!written.ok) return failureFrom(ctx.t, writeProblem(written.error));
  const file = `${PLAN_DIR}/${name}`;
  return {
    ...success({ schema: RESEARCH_SCHEMA, file, topic, created: true }, [ctx.t("research.created", { file })]),
    next: `finitemonkey research check ${file}`,
  };
};

export const researchNewCommand: CommandSpec = {
  path: ["research", "new"],
  summaryKey: "command.research_new.summary",
  usage: "finitemonkey research new <topic>",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => {
    const topic = args.positionals[0]?.trim() ?? "";
    if (topic === "")
      return Promise.resolve(
        failureFrom(
          ctx.t,
          usageProblem("invalid_arguments", "inventory.error.topic", "finitemonkey research new <topic>"),
        ),
      );
    return inRepo(ctx, (root) => newRecord(ctx, root, topic));
  },
};

export const researchCheckCommand: CommandSpec = {
  path: ["research", "check"],
  summaryKey: "command.research_check.summary",
  usage: "finitemonkey research check [<docs/plan/NNb-state-of-the-art-topic.md>]",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) =>
    inRepo(ctx, (root) => {
      const only = args.positionals[0]?.replace(/^.*[\\/]/, "");
      const records = researchRecords(ctx.runtime, root, only);
      const issues = records.flatMap((record) => record.issues);
      const data = { schema: RESEARCH_SCHEMA, records: records.length, issues };
      if (issues.length === 0) return success(data, [ctx.t("research.clean", { count: records.length })]);
      return failureFrom(
        ctx.t,
        {
          code: "research_invalid",
          messageKey: "research.error.invalid",
          params: { count: issues.length },
          fix: "date every source, mark its kind and fix each line listed, then run finitemonkey research check again",
          exitCode: ExitCode.CheckFailed,
          data,
        },
        issues.map(
          (item) =>
            `  ${item.file}:${String(item.line)} ${ctx.t(`research.issue.${item.kind}`, { detail: item.detail })}`,
        ),
      );
    }),
};
