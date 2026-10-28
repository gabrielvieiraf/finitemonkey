import { listOption, stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import type { Parsed } from "../core/parsed.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { checkParity } from "../parity/check.js";
import { initParity, PARITY_SCHEMA, type ParityProblem, type ParityWritten, updateParity } from "../parity/run.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

type Root = NonNullable<ReturnType<typeof repoOf>>["root"];

const inRepo = (ctx: Ctx, run: (root: Root) => CommandResult): Promise<CommandResult> => {
  const repo = repoOf(ctx);
  return Promise.resolve(repo === undefined ? failureFrom(ctx.t, notRepository(ctx.cwd)) : run(repo.root));
};

export const parityResult = (ctx: Ctx, written: Parsed<ParityWritten, ParityProblem>, ref: string): CommandResult => {
  if (written.ok)
    return success({ schema: PARITY_SCHEMA, file: "docs/plan/parity.csv", ...written.value }, [
      ctx.t("parity.written", { rows: written.value.rows, added: written.value.added }),
    ]);
  if (written.error === "write")
    return failureFrom(ctx.t, {
      code: "plan_write_failed",
      messageKey: "plan.error.write",
      params: { detail: "docs/plan/parity.csv" },
      fix: "check that docs/plan can be written",
      exitCode: ExitCode.CheckFailed,
    });
  return failureFrom(
    ctx.t,
    usageProblem("invalid_arguments", `parity.error.${written.error}`, "finitemonkey help parity", { ref }),
  );
};

export const parityInitCommand: CommandSpec = {
  path: ["parity", "init"],
  summaryKey: "command.parity_init.summary",
  usage: "finitemonkey parity init [--ref <ref>] [--path <dir>]...",
  status: "ready",
  options: { ref: { type: "string" }, path: { type: "string", multiple: true } },
  run: (ctx, args) =>
    inRepo(ctx, (root) => {
      const ref = stringOption(args.values, "ref") ?? "HEAD";
      return parityResult(ctx, initParity(ctx.runtime, root, ref, listOption(args.values, "path")), ref);
    }),
};

export const parityUpdateCommand: CommandSpec = {
  path: ["parity", "update"],
  summaryKey: "command.parity_update.summary",
  usage: "finitemonkey parity update [--ref <ref>]",
  status: "ready",
  options: { ref: { type: "string" } },
  run: (ctx, args) =>
    inRepo(ctx, (root) => {
      const ref = stringOption(args.values, "ref") ?? "HEAD";
      return parityResult(ctx, updateParity(ctx.runtime, root, ref), ref);
    }),
};

export const parityCheckCommand: CommandSpec = {
  path: ["parity", "check"],
  summaryKey: "command.parity_check.summary",
  usage: "finitemonkey parity check",
  status: "ready",
  run: (ctx) =>
    inRepo(ctx, (root) => {
      const checked = checkParity(ctx.runtime, root);
      const data = { schema: PARITY_SCHEMA, ...checked };
      if (checked.issues.length === 0) return success(data, [ctx.t("parity.clean", { count: checked.rows })]);
      return failureFrom(
        ctx.t,
        {
          code: "parity_check_failed",
          messageKey: "parity.error.check",
          params: { count: checked.issues.length },
          fix: "give each row a destination, a parity test and a green state, or mark it removed with its decision",
          exitCode: ExitCode.CheckFailed,
          data,
        },
        checked.issues.map(
          (item) =>
            `  ${checked.file}:${String(item.line)} ${ctx.t(`parity.issue.${item.kind}`, { detail: item.detail })}`,
        ),
      );
    }),
};
