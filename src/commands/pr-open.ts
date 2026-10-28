import { stringOption } from "../core/args.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import type { Problem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { openPr, type PrOpenFailure } from "../pr/open.js";
import { isPerson, personName } from "../secrets/project.js";
import { notRepository } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const PR_OPEN_SCHEMA = "finitemonkey/pr-open@1";

const problem = (
  code: Problem["code"],
  messageKey: Problem["messageKey"],
  fix: string,
  params: Problem["params"],
  exitCode: Problem["exitCode"] = ExitCode.CheckFailed,
): Problem => ({ code, messageKey, params, fix, exitCode });

const problemOf = (ctx: Ctx, failure: PrOpenFailure): Problem => {
  switch (failure.kind) {
    case "not-repo":
      return notRepository(ctx.cwd);
    case "no-branch":
      return problem("pr_failed", "pr.error.no_branch", "git switch -c <type>/<issue>-<slug>", {});
    case "protected":
      return problem("pr_failed", "pr.error.protected", "git switch -c <type>/<issue>-<slug>", {
        branch: failure.branch,
      });
    case "parent-open":
      return problem("pr_parent_open", "pr.error.parent_open", `finitemonkey pr open --base ${failure.parent}`, {
        parent: failure.parent,
      });
    case "restack":
      return problem("pr_failed", "pr.error.restack", "finitemonkey undo --list", { detail: failure.detail });
    case "conflict":
      return problem("pr_conflict", "pr.error.conflict", `finitemonkey merge ${failure.base}`, {
        base: failure.base,
        files: failure.files.join(", "),
      });
    case "outside":
      return problem(
        "pr_outside_scope",
        "pr.error.outside",
        'finitemonkey pr open --accept-outside "<why>"',
        { files: failure.files.map((file) => file.path).join(", ") },
        ExitCode.NeedsPerson,
      );
    case "push":
    case "gh":
      return problem("pr_failed", "pr.error.failed", "gh auth status", { detail: failure.detail });
  }
};

const bodyOf = (ctx: Ctx, values: Readonly<Record<string, unknown>>): string => {
  const file = typeof values["body-file"] === "string" ? values["body-file"] : undefined;
  if (file !== undefined) {
    const read = ctx.runtime.readText(toAbsolutePath(file, ctx.cwd));
    if (read.ok) return read.value;
  }
  return typeof values["body"] === "string" ? values["body"] : "";
};

export const prOpenCommand: CommandSpec = {
  path: ["pr", "open"],
  summaryKey: "pr.command.open",
  usage:
    'finitemonkey pr open [--base <branch>] [--title <text>] [--body <text> | --body-file <file>] [--task <contract>] [--accept-outside "<why>"] [--draft] [--dry-run] [--json]',
  status: "ready",
  options: {
    base: { type: "string" },
    title: { type: "string" },
    body: { type: "string" },
    "body-file": { type: "string" },
    task: { type: "string" },
    "accept-outside": { type: "string" },
    draft: { type: "boolean" },
  },
  run: (ctx, args): Promise<CommandResult> => {
    const person = isPerson(ctx);
    const opened = openPr(ctx.runtime, ctx.cwd, {
      base: stringOption(args.values, "base"),
      title: stringOption(args.values, "title"),
      body: bodyOf(ctx, args.values),
      contract: stringOption(args.values, "task"),
      acceptOutside: stringOption(args.values, "accept-outside"),
      acceptedBy: person ? personName(ctx) : `${personName(ctx)} (Claude Code permission prompt)`,
      draft: args.values["draft"] === true,
      dryRun: ctx.dryRun,
    });
    if (!opened.ok) return Promise.resolve(failureFrom(ctx.t, problemOf(ctx, opened.error)));
    const data = { schema: PR_OPEN_SCHEMA, ...opened.value };
    const head =
      opened.value.url === undefined
        ? ctx.t("pr.open.dry_run", { branch: data.branch, base: data.base })
        : ctx.t("pr.open.done", { url: opened.value.url });
    return Promise.resolve(success(data, [head, ...(opened.value.url === undefined ? [data.body] : [])]));
  },
};
