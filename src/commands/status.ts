import { type StatusData, statusOf } from "../bridge/status.js";
import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { gitAt, gitRoot } from "../gate/git.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

const MARK: Readonly<Record<string, string>> = { passed: "✓", failed: "✗", unverified: "○" };

const humanLines = (ctx: Ctx, data: StatusData): readonly string[] => [
  ctx.t("status.summary", {
    light: data.gate.light,
    passed: data.counts.passed,
    total: data.checks.length,
    task: data.task ?? "-",
  }),
  ...(data.contract === null ? [] : [ctx.t("status.contract", { id: data.contract.id, hash: data.contract.hash })]),
  ...(data.editsSinceGate !== null && data.editsSinceGate > 0
    ? [ctx.t("status.edits", { count: data.editsSinceGate })]
    : []),
  ...(data.bypasses > 0 ? [ctx.t("bypass.refused", { count: data.bypasses })] : []),
  ...data.checks.map((check) => `${MARK[check.status] ?? "○"} ${check.id}${check.stale ? " (stale)" : ""}`),
  ...data.notVerified.map((item) =>
    ctx.t("status.not_verified", { id: item.id, reason: item.reason, verify: item.verify }),
  ),
];

const show = (ctx: Ctx): CommandResult => {
  const root = gitRoot(gitAt(ctx.runtime, ctx.cwd));
  if (root === undefined)
    return failureFrom(ctx.t, {
      code: "not_a_git_repo",
      messageKey: "error.not_a_git_repo",
      params: {},
      fix: "git init",
      exitCode: ExitCode.NotConfigured,
    });
  const data = statusOf(ctx.runtime, fmPaths(root));
  return success(data, humanLines(ctx, data));
};

export const statusCommand: CommandSpec = {
  path: ["status"],
  summaryKey: "command.status.summary",
  usage: "finitemonkey status [--json]",
  status: "ready",
  run: (ctx) => Promise.resolve(show(ctx)),
};
