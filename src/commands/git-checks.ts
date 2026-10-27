import { stringOption } from "../core/args.js";
import { toAbsolutePath } from "../core/brand.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom } from "../core/result.js";
import { baseExists, ciBase, ciChecks } from "../githooks/ci.js";
import { commitMessageProblems } from "../githooks/commit-msg.js";
import { parsePushUpdates, prePushChecks, updatesFromEnv } from "../githooks/pre-push.js";
import { checksResult } from "../githooks/render.js";
import { readAll } from "../hooks/stdin.js";
import { commitRuleCheck, compiledFor } from "../rules/checks.js";
import { projectRoot } from "../secrets/project.js";
import { gitProblem, notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const COMMIT_MSG_SCHEMA = "finitemonkey/commit-msg@1";
export const PUSH_CHECK_SCHEMA = "finitemonkey/push-check@1";
export const CI_GATE_SCHEMA = "finitemonkey/ci-gate@1";

const COMMIT_MSG_USAGE = "finitemonkey commit-msg <message-file>";

export const commitMsgCommand: CommandSpec = {
  path: ["commit-msg"],
  summaryKey: "githooks.command.commit_msg",
  usage: COMMIT_MSG_USAGE,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => {
    const file = args.positionals[0];
    if (file === undefined)
      return Promise.resolve(
        failureFrom(
          ctx.t,
          usageProblem("invalid_arguments", "error.invalid_arguments", COMMIT_MSG_USAGE, { detail: "<message-file>" }),
        ),
      );
    const text = ctx.runtime.readText(toAbsolutePath(file, ctx.cwd));
    if (!text.ok)
      return Promise.resolve(
        failureFrom(
          ctx.t,
          usageProblem("invalid_arguments", "error.invalid_arguments", COMMIT_MSG_USAGE, { detail: file }),
        ),
      );
    const failures = commitMessageProblems(text.value);
    const fix = "git commit --amend, using type(scope): subject and no AI attribution lines";
    return Promise.resolve(
      checksResult(ctx.t, COMMIT_MSG_SCHEMA, "githook_failed", [
        { id: "commit-messages", failures, fix },
        commitRuleCheck(compiledFor(ctx.runtime, projectRoot(ctx), "git"), text.value),
      ]),
    );
  },
};

export const pushCheckCommand: CommandSpec = {
  path: ["push", "check"],
  summaryKey: "githooks.command.push_check",
  usage: "finitemonkey push check [<remote>] < pre-push stdin",
  status: "ready",
  maxPositionals: 2,
  run: async (ctx, args): Promise<CommandResult> => {
    const repo = repoOf(ctx);
    if (repo === undefined) return failureFrom(ctx.t, notRepository(ctx.cwd));
    const piped = parsePushUpdates(ctx.io.stdin.isTTY === true ? "" : await readAll(ctx.io.stdin));
    const updates = piped.length > 0 ? piped : updatesFromEnv(ctx.env);
    const checks = prePushChecks(ctx.runtime, repo, args.positionals[0] ?? "origin", updates);
    return checksResult(ctx.t, PUSH_CHECK_SCHEMA, "githook_failed", checks);
  },
};

export const ciGateCommand: CommandSpec = {
  path: ["ci", "gate"],
  summaryKey: "githooks.command.ci_gate",
  usage: "finitemonkey ci gate [--base <ref>]",
  status: "ready",
  options: { base: { type: "string" } },
  run: (ctx, args) => {
    const repo = repoOf(ctx);
    if (repo === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const base = ciBase(ctx.runtime, repo, ctx.env, stringOption(args.values, "base"));
    if (!baseExists(ctx.runtime, repo, base))
      return Promise.resolve(
        failureFrom(
          ctx.t,
          gitProblem(
            "githook_failed",
            "githooks.error.no_base",
            base,
            `git fetch origin && finitemonkey ci gate --base ${base}`,
          ),
        ),
      );
    return Promise.resolve(checksResult(ctx.t, CI_GATE_SCHEMA, "ci_gate_failed", ciChecks(ctx.runtime, repo, base)));
  },
};
