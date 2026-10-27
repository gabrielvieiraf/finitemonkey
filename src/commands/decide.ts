import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { type Problem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { checkDecisions, type DecisionIssue } from "../decide/check.js";
import { revokeDecision } from "../decide/revoke.js";
import { DECISION_SCHEMA } from "../decide/sections.js";
import { renderDecision } from "../decide/template.js";
import { ExitCode } from "../exit-codes.js";
import { nextNumber, PLAN_DIR, planDir, planFiles, planPath, slugOf } from "../plan/folder.js";
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

const baseName = (file: string): string => file.replace(/^.*[\\/]/, "");

export const decisionLine = (ctx: Pick<Ctx, "t">, item: DecisionIssue): string =>
  `${item.file}:${String(item.line)} ${ctx.t(`decision.issue.${item.kind}`, { detail: item.detail })}`;

const newRecord = (ctx: Ctx, root: Root, topic: string): CommandResult => {
  const names = planFiles(ctx.runtime, root);
  const name = `${nextNumber(names)}-decision-${slugOf(topic)}.md`;
  const made = ctx.runtime.mkdir(planDir(root));
  const written = made.ok
    ? ctx.runtime.writeText(planPath(root, name), renderDecision(ctx.t, topic, ctx.runtime.now().slice(0, 10)))
    : made;
  if (!written.ok) return failureFrom(ctx.t, writeProblem(written.error));
  const file = `${PLAN_DIR}/${name}`;
  return {
    ...success({ schema: DECISION_SCHEMA, file, topic }, [ctx.t("decision.created", { file })]),
    next: `finitemonkey decide check ${file}`,
  };
};

export const decideNewCommand: CommandSpec = {
  path: ["decide", "new"],
  summaryKey: "command.decide_new.summary",
  usage: "finitemonkey decide new <topic>",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => {
    const topic = args.positionals[0]?.trim() ?? "";
    if (topic === "")
      return Promise.resolve(
        failureFrom(
          ctx.t,
          usageProblem("invalid_arguments", "inventory.error.topic", "finitemonkey decide new <topic>"),
        ),
      );
    return inRepo(ctx, (root) => newRecord(ctx, root, topic));
  },
};

export const decideCheckCommand: CommandSpec = {
  path: ["decide", "check"],
  summaryKey: "command.decide_check.summary",
  usage: "finitemonkey decide check [<docs/plan/NN-decision-topic.md>]",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) =>
    inRepo(ctx, (root) => {
      const only = args.positionals[0] === undefined ? undefined : baseName(args.positionals[0]);
      const checked = checkDecisions(ctx.runtime, root, only);
      const data = { schema: DECISION_SCHEMA, ...checked };
      if (checked.issues.length === 0) return success(data, [ctx.t("decision.clean", { count: checked.records })]);
      return failureFrom(
        ctx.t,
        {
          code: "decision_invalid",
          messageKey: "decision.error.invalid",
          params: { count: checked.issues.length },
          fix: "fill or reorder the sections listed, then run finitemonkey decide check again",
          exitCode: ExitCode.CheckFailed,
          data,
        },
        checked.issues.map((item) => `  ${decisionLine(ctx, item)}`),
      );
    }),
};

export const decideRevokeCommand: CommandSpec = {
  path: ["decide", "revoke"],
  summaryKey: "command.decide_revoke.summary",
  usage: "finitemonkey decide revoke <record> --by <new record>",
  status: "ready",
  maxPositionals: 1,
  options: { by: { type: "string" } },
  run: (ctx, args) => {
    const target = args.positionals[0];
    const by = stringOption(args.values, "by");
    const usage = "finitemonkey decide revoke <record> --by <new record>";
    if (target === undefined || by === undefined)
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "decision.error.revoke_usage", usage)),
      );
    return inRepo(ctx, (root) => {
      const revoked = revokeDecision(ctx.runtime, ctx.t, root, baseName(target), baseName(by));
      if (revoked.ok)
        return success(
          { schema: DECISION_SCHEMA, file: `${PLAN_DIR}/${revoked.value}`, replacedBy: `${PLAN_DIR}/${baseName(by)}` },
          [ctx.t("decision.revoked_done", { file: revoked.value, by: baseName(by) })],
        );
      if (revoked.error === "write_failed") return failureFrom(ctx.t, writeProblem(target));
      return failureFrom(
        ctx.t,
        usageProblem("invalid_arguments", `decision.error.${revoked.error}`, usage, {
          file: baseName(target),
          by: baseName(by),
        }),
      );
    });
  },
};
