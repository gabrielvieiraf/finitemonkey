import { modState } from "../bridge/state.js";
import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { ExitCode } from "../exit-codes.js";
import { gitAt, gitRoot } from "../gate/git.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

const projectOf = (ctx: Ctx): FmPaths | undefined => {
  const root = gitRoot(gitAt(ctx.runtime, ctx.cwd));
  return root === undefined ? undefined : fmPaths(root);
};

const noRepo = (ctx: Ctx): CommandResult =>
  failureFrom(ctx.t, {
    code: "not_a_git_repo",
    messageKey: "error.not_a_git_repo",
    params: {},
    fix: "git init",
    exitCode: ExitCode.NotConfigured,
  });

const showState = (ctx: Ctx): CommandResult => {
  const paths = projectOf(ctx);
  if (paths === undefined) return noRepo(ctx);
  const state = modState(ctx.runtime, paths, ctx.t);
  return success(state, [
    ctx.t("mod.state.summary", { mode: state.mode, count: state.rules.length }),
    ...state.rules.map((rule) => `${rule.id}: ${rule.pattern}`),
  ]);
};

const MODES = new Set(["off", "shadow", "active"]);

const recordTightening = (ctx: Ctx, rule: string | undefined, tool: string | undefined, mode: string | undefined) => {
  const paths = projectOf(ctx);
  if (paths === undefined) return noRepo(ctx);
  if (rule === undefined || tool === undefined || mode === undefined || !MODES.has(mode))
    return failureFrom(ctx.t, {
      code: "invalid_arguments",
      messageKey: "error.invalid_arguments",
      params: { detail: "--rule, --tool and --mode are required" },
      fix: "finitemonkey help mod record",
      exitCode: ExitCode.Usage,
    });
  logEvent(ctx.runtime, paths, "mod_tightened", { rule, tool, mode });
  return success({ rule, tool, mode }, []);
};

export const modStateCommand: CommandSpec = {
  path: ["mod", "state"],
  summaryKey: "command.mod_state.summary",
  usage: "finitemonkey mod state [--json]",
  status: "ready",
  run: (ctx) => Promise.resolve(showState(ctx)),
};

export const modRecordCommand: CommandSpec = {
  path: ["mod", "record"],
  summaryKey: "command.mod_record.summary",
  usage: "finitemonkey mod record --rule <id> --tool <name> --mode shadow|active",
  status: "ready",
  options: { rule: { type: "string" }, tool: { type: "string" }, mode: { type: "string" } },
  run: (ctx, args) =>
    Promise.resolve(
      recordTightening(
        ctx,
        stringOption(args.values, "rule"),
        stringOption(args.values, "tool"),
        stringOption(args.values, "mode"),
      ),
    ),
};
