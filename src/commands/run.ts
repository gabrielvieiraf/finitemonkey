import { join } from "node:path";

import { stringOption } from "../core/args.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { maskText } from "../mask/mask.js";
import { commandLine, defaultShell, invocationFor, parseShellChoice, SHELLS } from "../runlog/shell.js";
import { errorLines, fullLog } from "../runlog/summary.js";
import { FM_DIR } from "../task/paths.js";
import { unattended } from "./run-unattended.js";
import type { CommandSpec } from "./types.js";

export const RUN_SCHEMA = "finitemonkey/run@1";
export const RUNS_DIR = "runs";
const USAGE = `finitemonkey run [--shell ${SHELLS.join("|")}] [--timeout <seconds>] -- <command> | finitemonkey run --unattended <task>`;
const DEFAULT_TIMEOUT_S = 600;
const KEEP_RUNS = 30;
const NOT_FOUND_EXIT = 127;
const TIMEOUT_EXIT = 124;

const slug = (line: string): string =>
  line
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "command";

const timeoutOf = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return DEFAULT_TIMEOUT_S;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const prune = (ctx: Ctx, dir: ReturnType<typeof toAbsolutePath>): void => {
  const names = ctx.runtime.listDir(dir);
  if (!names.ok) return;
  const old = [...names.value]
    .filter((name) => name.endsWith(".log"))
    .sort()
    .slice(0, -KEEP_RUNS);
  for (const name of old) ctx.runtime.remove(toAbsolutePath(join(dir, name)));
};

const saveLog = (ctx: Ctx, root: ReturnType<typeof toAbsolutePath>, line: string, text: string): string => {
  const dir = toAbsolutePath(join(root, FM_DIR, RUNS_DIR));
  const name = `${ctx.runtime.now().replace(/[:.]/g, "-")}-${slug(line)}.log`;
  ctx.runtime.writeText(toAbsolutePath(join(dir, name)), text);
  prune(ctx, dir);
  return `${FM_DIR}/${RUNS_DIR}/${name}`;
};

const usage = (ctx: Ctx, detail: string): CommandResult =>
  failureFrom(ctx.t, usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail }));

const runCommand = (
  ctx: Ctx,
  words: readonly string[],
  shellRaw: string | undefined,
  timeoutRaw: string | undefined,
) => {
  const shell = shellRaw === undefined ? defaultShell(ctx.platform) : parseShellChoice(shellRaw);
  const timeoutS = timeoutOf(timeoutRaw);
  if (words.length === 0 || shell === undefined || timeoutS === undefined) return usage(ctx, words.join(" "));
  const line = commandLine(words);
  const root = findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd;
  const invocation = invocationFor(shell, words);
  const result = ctx.runtime.exec({ ...invocation, cwd: ctx.cwd, timeoutMs: timeoutS * 1000 });
  const exitCode = result.timedOut ? TIMEOUT_EXIT : (result.exitCode ?? NOT_FOUND_EXIT);
  const shown = saveLog(ctx, root, line, fullLog(line, exitCode, result.stdout, result.stderr));
  const errors = errorLines(`${result.stdout}\n${result.stderr}`, exitCode);
  const lines = [
    ...errors,
    ctx.t("run.summary", { exit: exitCode, file: shown, ms: result.durationMs }),
    ...(result.timedOut ? [ctx.t("run.timed_out", { seconds: timeoutS })] : []),
  ];
  const data = {
    schema: RUN_SCHEMA,
    command: maskText(line),
    shell,
    exitCode,
    file: shown,
    errors,
    timedOut: result.timedOut,
  };
  if (exitCode === 0) return success(data, lines);
  return {
    ...failureFrom(
      ctx.t,
      {
        code: "run_failed",
        messageKey: "run.failed",
        params: { exit: exitCode },
        fix: shown,
        exitCode: ExitCode.CheckFailed,
        data,
      },
      lines,
    ),
    passthroughExit: exitCode,
  };
};

export const runCommandSpec: CommandSpec = {
  path: ["run"],
  summaryKey: "command.run.summary",
  usage: USAGE,
  status: "ready",
  options: { shell: { type: "string" }, timeout: { type: "string" }, unattended: { type: "boolean" } },
  maxPositionals: 1000,
  run: (ctx, args) =>
    Promise.resolve(
      args.values["unattended"] === true
        ? unattended(ctx, args.positionals[0])
        : runCommand(ctx, args.positionals, stringOption(args.values, "shell"), stringOption(args.values, "timeout")),
    ),
};
