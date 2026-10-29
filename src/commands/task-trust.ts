import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { type PendingContract, pendingContract, trustContract } from "../gate/trust-contract.js";
import type { Example } from "../task/examples.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import type { AcceptanceCheck } from "../task/types.js";
import { TASK_SCHEMA } from "../task/types.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

const USAGE = "finitemonkey task trust [<id>] [--hash <hash> [--digest <digest>]]";

const checkText = (check: AcceptanceCheck): string => check.description ?? check.run ?? check.kind;

const exampleData = (example: Example): Readonly<Record<string, string>> => ({
  id: example.id,
  status: example.status,
  says: example.says,
});

const shown = (ctx: Ctx, pending: PendingContract): CommandResult =>
  success(
    {
      schema: TASK_SCHEMA,
      task: pending.task,
      goal: pending.contract.goal,
      hash: pending.hash,
      digest: pending.digest,
      trusted: pending.trusted,
      acceptance: pending.contract.acceptance.map((check) => ({ id: check.id, says: checkText(check) })),
      examples: pending.examples.map(exampleData),
    },
    [
      ctx.t("trust.header", { task: pending.task, hash: pending.hash.slice(0, 12), goal: pending.contract.goal }),
      ...pending.contract.acceptance.map((check) => ctx.t("trust.check", { id: check.id, says: checkText(check) })),
      ...pending.examples.map((example) =>
        ctx.t("trust.example", { id: example.id, status: example.status, says: example.says }),
      ),
      ctx.t(pending.trusted ? "trust.already" : "trust.how", { task: pending.task }),
    ],
  );

const approve = (ctx: Ctx, paths: FmPaths, task: string, hash: string, digest: string | undefined): CommandResult => {
  const outcome = trustContract(ctx.runtime, paths, task, `person@${ctx.runtime.now()}`, {
    hash,
    ...(digest === undefined ? {} : { digest }),
  });
  if (outcome.kind === "failed")
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "gate.release.trust_failed", USAGE, { task }));
  if (outcome.kind === "stale")
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "trust.stale", `finitemonkey task trust ${task}`, {
        task,
        shown: hash.slice(0, 12),
        current: outcome.hash.slice(0, 12),
      }),
    );
  logEvent(ctx.runtime, paths, "person.trust", { task, hash: outcome.hash, via: "cli" });
  return success({ schema: TASK_SCHEMA, task, hash: outcome.hash, trusted: true }, [
    ctx.t("gate.release.trusted", { task }),
  ]);
};

export const taskTrustCommand: CommandSpec = {
  path: ["task", "trust"],
  summaryKey: "command.task_trust.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { hash: { type: "string" }, digest: { type: "string" } },
  run: (ctx, args): Promise<CommandResult> => {
    const repo = repoOf(ctx);
    if (repo === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const paths = fmPaths(repo.root);
    const task = args.positionals[0] ?? readState(ctx.runtime, paths).active;
    if (task === undefined)
      return Promise.resolve(failureFrom(ctx.t, usageProblem("invalid_arguments", "examples.no_task", USAGE)));
    const hash = stringOption(args.values, "hash");
    if (hash !== undefined)
      return Promise.resolve(approve(ctx, paths, task, hash, stringOption(args.values, "digest")));
    const pending = pendingContract(ctx.runtime, paths, task);
    if (pending === undefined)
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("task_not_found", "error.task_not_found", USAGE, { task })),
      );
    return Promise.resolve(shown(ctx, pending));
  },
};
