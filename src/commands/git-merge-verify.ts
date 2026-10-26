import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { findingLabel } from "../git/hooks/stop.js";
import { mergeCommitsSince, mergeInProgress } from "../git/merge/inputs.js";
import { verifyMerge, type VerifyReport } from "../git/merge/verify.js";
import type { Repo } from "../git/repo.js";
import { gitProblem, notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const MERGE_VERIFY_RUN_SCHEMA = "finitemonkey/merge-verify-run@1";

interface Checked {
  readonly commit: string;
  readonly report: VerifyReport;
}

const short = (sha: string | undefined): string => (sha ?? "?").slice(0, 12);

const humanOf = (ctx: Ctx, item: Checked): readonly string[] => {
  const { report } = item;
  const range = {
    base: short(report.base),
    result: item.commit === "MERGE_HEAD" ? "working tree" : short(item.commit),
  };
  if (report.exit === 2) return [ctx.t("git.error.merge_unanalyzable", { detail: report.error ?? "" })];
  if (report.exit === 0) {
    return [ctx.t("git.merge.ok", { ...range, files: report.files, justified: report.justified })];
  }
  return [
    ctx.t("git.merge.lost", { ...range, count: report.findings.length }),
    ...report.findings.map((finding) =>
      ctx.t("git.merge.finding", {
        where: findingLabel(finding),
        kind: finding.kind,
        side: finding.side ?? "-",
        text: finding.text,
      }),
    ),
  ];
};

const headIsMerge = (ctx: Ctx, repo: Repo): boolean => {
  const parents = ctx.runtime.git(["rev-list", "--parents", "-n", "1", "HEAD"], repo.root).stdout.trim().split(" ");
  return parents.length > 2;
};

const targetsOf = (ctx: Ctx, repo: Repo, rev: string | undefined, since: string | undefined): readonly string[] => {
  if (since !== undefined) return mergeCommitsSince(ctx.runtime, repo, since);
  if (rev !== undefined) return [rev];
  if (mergeInProgress(ctx.runtime, repo)) return ["MERGE_HEAD"];
  return headIsMerge(ctx, repo) ? ["HEAD"] : [];
};

const resultOf = (ctx: Ctx, checked: readonly Checked[]): CommandResult => {
  const human = [...checked.flatMap((item) => humanOf(ctx, item)), ctx.t("git.merge.limits")];
  const data = { schema: MERGE_VERIFY_RUN_SCHEMA, merges: checked };
  const broken = checked.find((item) => item.report.exit === 2);
  if (broken !== undefined) {
    const detail = broken.report.error ?? "";
    const problem = gitProblem("merge_unanalyzable", "git.error.merge_unanalyzable", detail, "git status");
    return failureFrom(ctx.t, { ...problem, exitCode: ExitCode.Usage, data }, human);
  }
  const lost = checked.reduce((count, item) => count + item.report.findings.length, 0);
  if (lost === 0) return success(data, human);
  return failureFrom(
    ctx.t,
    {
      code: "merge_lost_work",
      messageKey: "git.error.merge_lost",
      params: { count: lost },
      fix: "finitemonkey merge verify --dropped .finitemonkey/merge-dropped.json",
      exitCode: ExitCode.CheckFailed,
      data,
    },
    human,
  );
};

export const mergeVerifyCommand: CommandSpec = {
  path: ["merge", "verify"],
  summaryKey: "git.command.merge_verify",
  usage: "finitemonkey merge verify [<merge-commit>] [--since <ref>] [--dropped <file>] [--json]",
  status: "ready",
  options: { since: { type: "string" }, dropped: { type: "string" } },
  maxPositionals: 1,
  run: (ctx, args): Promise<CommandResult> => {
    const repo = repoOf(ctx);
    if (repo === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const dropped = stringOption(args.values, "dropped");
    const targets = targetsOf(ctx, repo, args.positionals[0], stringOption(args.values, "since"));
    if (targets.length === 0) {
      const data = { schema: MERGE_VERIFY_RUN_SCHEMA, merges: [] };
      return Promise.resolve(success(data, [ctx.t("git.merge.none", { detail: "HEAD" })]));
    }
    const checked = targets.map((commit) => ({
      commit,
      report: verifyMerge(ctx.runtime, repo, {
        ...(commit === "MERGE_HEAD" ? {} : { rev: commit }),
        ...(dropped === undefined ? {} : { droppedFile: dropped }),
      }),
    }));
    return Promise.resolve(resultOf(ctx, checked));
  },
};
