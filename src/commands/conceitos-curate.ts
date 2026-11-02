import { type CurateAction, curateConcept } from "../conceitos/curate.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { isPerson } from "../secrets/project.js";
import {
  CONCEITOS_SCHEMA,
  conceitosCommand,
  conceitosExportCommand,
  conceitosMarkCommand,
  conceitosUpdateCommand,
  pathsOf,
} from "./conceitos.js";
import { conceitosMigrateCommand } from "./conceitos-migrate.js";
import type { CommandSpec } from "./types.js";

const USAGE: Readonly<Record<CurateAction, string>> = {
  rename: "finitemonkey conceitos rename <concept> <new-id>",
  merge: "finitemonkey conceitos merge <concept> <into>",
  forget: "finitemonkey conceitos forget <concept>",
};

const curate = (ctx: Ctx, action: CurateAction, from: string | undefined, to: string | undefined): CommandResult => {
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("perfil.error.person_only", USAGE[action]));
  const outcome = curateConcept(ctx.runtime, pathsOf(ctx), action, from, to);
  if (!outcome.ok)
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", `conceitos.curate.${outcome.reason}`, USAGE[action], {
        concept: outcome.concept,
      }),
    );
  const line =
    outcome.to === null
      ? ctx.t("conceitos.curate.forgot", { concept: outcome.from })
      : ctx.t("conceitos.curate.moved", { from: outcome.from, to: outcome.to });
  return success({ schema: CONCEITOS_SCHEMA, action, from: outcome.from, to: outcome.to }, [line]);
};

export const conceitosRenameCommand: CommandSpec = {
  path: ["conceitos", "rename"],
  summaryKey: "command.conceitos_rename.summary",
  usage: USAGE.rename,
  status: "ready",
  maxPositionals: 2,
  run: (ctx, args) => Promise.resolve(curate(ctx, "rename", args.positionals[0], args.positionals[1])),
};

export const conceitosMergeCommand: CommandSpec = {
  path: ["conceitos", "merge"],
  summaryKey: "command.conceitos_merge.summary",
  usage: USAGE.merge,
  status: "ready",
  maxPositionals: 2,
  run: (ctx, args) => Promise.resolve(curate(ctx, "merge", args.positionals[0], args.positionals[1])),
};

export const conceitosForgetCommand: CommandSpec = {
  path: ["conceitos", "forget"],
  summaryKey: "command.conceitos_forget.summary",
  usage: USAGE.forget,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => Promise.resolve(curate(ctx, "forget", args.positionals[0], undefined)),
};

export const CONCEITOS_COMMANDS: readonly CommandSpec[] = [
  conceitosCommand,
  conceitosExportCommand,
  conceitosUpdateCommand,
  conceitosMarkCommand,
  conceitosRenameCommand,
  conceitosMergeCommand,
  conceitosForgetCommand,
  conceitosMigrateCommand,
];
