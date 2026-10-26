import { stringOption } from "../core/args.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { rescueReport, restoreBranch } from "../git/rescue.js";
import type { Translate } from "../i18n/translate.js";
import { gitProblem, notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const RESCUE_SCHEMA = "finitemonkey/git-rescue@1";

const listing = (t: Translate, report: ReturnType<typeof rescueReport>): readonly string[] => [
  t("git.rescue.title"),
  ...report.commits.map((commit) =>
    commit.source === "reflog"
      ? t("git.rescue.reflog", {
          ref: commit.ref ?? "",
          sha: commit.sha.slice(0, 12),
          when: commit.when,
          subject: commit.subject,
        })
      : t("git.rescue.dangling", { sha: commit.sha.slice(0, 12), when: commit.when, subject: commit.subject }),
  ),
  ...(report.blobs > 0 ? [t("git.rescue.blobs", { count: report.blobs })] : []),
  t("git.rescue.never_staged"),
  ...(report.commits.length > 0 ? [t("git.rescue.next")] : []),
];

export const rescueCommand: CommandSpec = {
  path: ["rescue"],
  summaryKey: "git.command.rescue",
  usage: "finitemonkey rescue [--restore <sha> --branch <name>] [--json]",
  status: "ready",
  options: { restore: { type: "string" }, branch: { type: "string" } },
  run: (ctx, args): Promise<CommandResult> => {
    const repo = repoOf(ctx);
    if (repo === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const sha = stringOption(args.values, "restore");
    const branch = stringOption(args.values, "branch");
    if (sha === undefined && branch === undefined) {
      const report = rescueReport(ctx.runtime, repo);
      return Promise.resolve(success({ schema: RESCUE_SCHEMA, action: "list", ...report }, listing(ctx.t, report)));
    }
    if (sha === undefined || branch === undefined) {
      const fix = "finitemonkey rescue --restore <sha> --branch <name>";
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "error.invalid_arguments", fix, { detail: fix })),
      );
    }
    const made = restoreBranch(ctx.runtime, repo, sha, branch);
    if (!made.ok) {
      return Promise.resolve(
        failureFrom(
          ctx.t,
          gitProblem("git_rescue_failed", "git.error.rescue_failed", made.error, "finitemonkey rescue"),
        ),
      );
    }
    return Promise.resolve(
      success({ schema: RESCUE_SCHEMA, action: "restore", sha: made.value, branch }, [
        ctx.t("git.rescue.restored", { branch, sha: made.value.slice(0, 12) }),
      ]),
    );
  },
};
