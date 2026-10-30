import type { Ctx } from "../core/context.js";
import { needsPersonProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { ExitCode } from "../exit-codes.js";
import { gitAt, gitRoot } from "../gate/git.js";
import { appendBypass, readBypasses, unreviewedBypasses } from "../guards/bypass/ledger.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

const review = (ctx: Ctx, ids: readonly string[]): CommandResult => {
  const root = gitRoot(gitAt(ctx.runtime, ctx.cwd));
  if (root === undefined)
    return failureFrom(ctx.t, {
      code: "not_a_git_repo",
      messageKey: "error.not_a_git_repo",
      params: {},
      fix: "git init",
      exitCode: ExitCode.NotConfigured,
    });
  const paths = fmPaths(root);
  const open = unreviewedBypasses(ctx.runtime, paths);
  const lines = open.map((entry) =>
    ctx.t("bypass.line", { id: entry.id, tool: entry.tool, summary: entry.summary, at: entry.at }),
  );
  if (open.length === 0 || ids.length === 0)
    return success({ bypasses: readBypasses(ctx.runtime, paths) }, [
      ctx.t("bypass.open", { count: open.length }),
      ...lines,
    ]);
  if (!isPerson(ctx))
    return failureFrom(ctx.t, needsPersonProblem("bypass.needs_person", "finitemonkey bypass review --all"));
  const chosen = open.filter((entry) => ids.includes("--all") || ids.includes(entry.id));
  for (const entry of chosen) appendBypass(ctx.runtime, paths, { ...entry, reviewed: true });
  logEvent(ctx.runtime, paths, "guard_bypass_reviewed", { ids: chosen.map((entry) => entry.id) });
  return success({ reviewed: chosen.map((entry) => entry.id) }, [ctx.t("bypass.reviewed", { count: chosen.length })]);
};

export const bypassReviewCommand: CommandSpec = {
  path: ["bypass", "review"],
  summaryKey: "command.bypass_review.summary",
  usage: "finitemonkey bypass review [<id>... | --all]",
  status: "ready",
  options: { all: { type: "boolean" } },
  run: (ctx, args) => Promise.resolve(review(ctx, args.values["all"] === true ? ["--all"] : args.positionals)),
};
