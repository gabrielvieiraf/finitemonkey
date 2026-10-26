import type { Ctx } from "../core/context.js";
import type { ErrorCode, Problem } from "../core/problem.js";
import { ExitCode, type FailureExitCode } from "../exit-codes.js";
import { openRepo, type Repo } from "../git/repo.js";
import type { MessageKey } from "../i18n/catalogs.js";

export const notRepository = (dir: string): Problem => ({
  code: "not_a_git_repo",
  messageKey: "error.not_a_git_repo",
  params: { dir },
  fix: "git init",
  exitCode: ExitCode.NotConfigured,
});

export const gitProblem = (
  code: ErrorCode,
  messageKey: MessageKey,
  detail: string,
  fix: string,
  exitCode: FailureExitCode = ExitCode.CheckFailed,
): Problem => ({ code, messageKey, params: { detail }, fix, exitCode });

export const repoOf = (ctx: Pick<Ctx, "cwd" | "runtime">): Repo | undefined => openRepo(ctx.runtime, ctx.cwd);
