import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { projectRoot } from "../secrets/project.js";
import { type LooseInstall, looseInstalls } from "../supply/frozen.js";
import { type LockConflict, lockConflicts } from "../supply/lockfiles.js";
import type { CommandSpec } from "./types.js";

export const DEPS_CHECK_SCHEMA = "finitemonkey/deps-check@1";

export interface DepsCheckData {
  readonly schema: typeof DEPS_CHECK_SCHEMA;
  readonly lockfiles: readonly LockConflict[];
  readonly installs: readonly LooseInstall[];
}

const lines = (ctx: Ctx, data: DepsCheckData): readonly string[] => [
  ...data.lockfiles.map((conflict) =>
    ctx.t("deps.check.lockfiles", {
      dir: conflict.dir === "" ? "." : conflict.dir,
      ecosystem: conflict.ecosystem,
      files: conflict.files.join(", "),
      count: conflict.files.length,
    }),
  ),
  ...data.installs.map((install) => ctx.t("deps.check.loose", { ...install })),
];

export const runDepsCheck = (ctx: Ctx): CommandResult<DepsCheckData> => {
  const root = projectRoot(ctx);
  const data: DepsCheckData = {
    schema: DEPS_CHECK_SCHEMA,
    lockfiles: lockConflicts(ctx.runtime, root),
    installs: looseInstalls(ctx.runtime, root),
  };
  const problems = data.lockfiles.length + data.installs.length;
  if (problems === 0) return success(data, [ctx.t("deps.check.clean")]);
  return failureFrom(
    ctx.t,
    {
      code: "deps_check_failed",
      messageKey: "deps.check.failed",
      params: { count: problems },
      fix: "keep one lockfile per ecosystem and install from it as is (npm ci, pnpm install --frozen-lockfile, uv sync --locked)",
      exitCode: ExitCode.CheckFailed,
      data,
    },
    lines(ctx, data),
  );
};

export const depsCheckCommand: CommandSpec = {
  path: ["deps", "check"],
  summaryKey: "deps.command.check",
  usage: "finitemonkey deps check",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => Promise.resolve(runDepsCheck(ctx)),
};
