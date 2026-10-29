import { stringOption } from "../core/args.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { approveUi, proposeUi, uiContractRelative, type UiContractState, uiContractState } from "../look/contract.js";
import { isPerson } from "../secrets/project.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const UI_CONTRACT_DATA_SCHEMA = "finitemonkey/ui-contract@1";

const PROPOSE_USAGE = "finitemonkey ui propose [<task>] --from <file>";
const APPROVE_USAGE = "finitemonkey ui approve [<task>] --hash <hash>";
const SHOW_USAGE = "finitemonkey ui show [<task>]";

export interface UiContractData extends UiContractState {
  readonly schema: typeof UI_CONTRACT_DATA_SCHEMA;
  readonly file: string;
}

type Target = { readonly paths: FmPaths; readonly task: string } | CommandResult;

const target = (ctx: Ctx, positional: string | undefined, usage: string): Target => {
  const repo = repoOf(ctx);
  if (repo === undefined) return failureFrom(ctx.t, notRepository(ctx.cwd));
  const paths = fmPaths(repo.root);
  const task = positional ?? readState(ctx.runtime, paths).active;
  if (task === undefined) return failureFrom(ctx.t, usageProblem("invalid_arguments", "ui.no_task", usage));
  return { paths, task };
};

const dataOf = (state: UiContractState): UiContractData => ({
  schema: UI_CONTRACT_DATA_SCHEMA,
  ...state,
  file: uiContractRelative(state.task),
});

const show = (ctx: Ctx, paths: FmPaths, task: string): CommandResult<UiContractData> => {
  const state = uiContractState(ctx.runtime, paths, task);
  const status = state.hash === undefined ? "none" : state.approved ? "approved" : "waiting";
  return success(dataOf(state), [
    ctx.t(`ui.show.${status}`, { task, hash: state.hash ?? "", screens: state.screens.length }),
    ...state.errors.map((error) => ctx.t("ui.invalid_line", { error })),
  ]);
};

const propose = (ctx: Ctx, paths: FmPaths, task: string, from: string | undefined): CommandResult => {
  const source = from === undefined ? undefined : ctx.runtime.readText(toAbsolutePath(from, ctx.cwd));
  if (source?.ok !== true)
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "error.invalid_arguments", PROPOSE_USAGE, { detail: "--from" }),
    );
  const made = proposeUi(ctx.runtime, paths, task, source.value);
  if (!made.ok)
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "ui.invalid", PROPOSE_USAGE, { errors: made.error.slice(0, 5).join("; ") }),
    );
  logEvent(ctx.runtime, paths, "ui.proposed", { task, hash: made.value });
  return {
    ...show(ctx, paths, task),
    human: [ctx.t("ui.proposed", { task, hash: made.value })],
    next: `finitemonkey ui approve ${task} --hash ${made.value}`,
  };
};

const approve = (ctx: Ctx, paths: FmPaths, task: string, hash: string | undefined): CommandResult => {
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("ui.person_only", APPROVE_USAGE));
  const done = approveUi(ctx.runtime, paths, task, hash);
  if (!done.ok)
    return failureFrom(ctx.t, usageProblem("invalid_arguments", `ui.approve.${done.error}`, SHOW_USAGE, { task }));
  logEvent(ctx.runtime, paths, "ui.approved", { task, hash: done.value });
  return { ...show(ctx, paths, task), human: [ctx.t("ui.approved", { task, hash: done.value })] };
};

const withTarget = (
  ctx: Ctx,
  positional: string | undefined,
  usage: string,
  run: (paths: FmPaths, task: string) => CommandResult,
): Promise<CommandResult> => {
  const found = target(ctx, positional, usage);
  return Promise.resolve("task" in found ? run(found.paths, found.task) : found);
};

export const uiShowCommand: CommandSpec = {
  path: ["ui", "show"],
  summaryKey: "command.ui_show.summary",
  usage: SHOW_USAGE,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => withTarget(ctx, args.positionals[0], SHOW_USAGE, (paths, task) => show(ctx, paths, task)),
};

export const uiProposeCommand: CommandSpec = {
  path: ["ui", "propose"],
  summaryKey: "command.ui_propose.summary",
  usage: PROPOSE_USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { from: { type: "string" } },
  run: (ctx, args) =>
    withTarget(ctx, args.positionals[0], PROPOSE_USAGE, (paths, task) =>
      propose(ctx, paths, task, stringOption(args.values, "from")),
    ),
};

export const uiApproveCommand: CommandSpec = {
  path: ["ui", "approve"],
  summaryKey: "command.ui_approve.summary",
  usage: APPROVE_USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { hash: { type: "string" } },
  run: (ctx, args) =>
    withTarget(ctx, args.positionals[0], APPROVE_USAGE, (paths, task) =>
      approve(ctx, paths, task, stringOption(args.values, "hash")),
    ),
};
