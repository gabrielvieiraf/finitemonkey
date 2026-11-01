import {
  applyMigration,
  CONCEITOS_MIGRATE_SCHEMA,
  type MigrationOutcome,
  planMigration,
} from "../conceitos/migrate.js";
import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import type { MessageKey } from "../i18n/catalogs.js";
import { fmPaths } from "../task/paths.js";
import { conceitosCommand, conceitosExportCommand, conceitosMarkCommand, conceitosUpdateCommand } from "./conceitos.js";
import type { CommandSpec } from "./types.js";

const USAGE = "finitemonkey conceitos migrate [--dry-run]";

const DONE: Readonly<Record<MigrationOutcome, MessageKey>> = {
  none: "conceitos.migrate.none",
  converted: "conceitos.migrate.done",
  mismatch: "conceitos.migrate.mismatch",
  write_failed: "conceitos.migrate.write_failed",
};

const migrate = (ctx: Ctx): CommandResult => {
  const paths = fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);
  const plan = planMigration(ctx.runtime, paths);
  const listed = plan.files.map((item) => ctx.t("conceitos.migrate.file", { file: item.file, entries: item.entries }));
  const data = { schema: CONCEITOS_MIGRATE_SCHEMA, dryRun: ctx.dryRun, files: plan.files };
  if (plan.files.length === 0) return success({ ...data, converted: false }, [ctx.t("conceitos.migrate.none")]);
  if (ctx.dryRun) return success({ ...data, converted: false }, [ctx.t("conceitos.migrate.dry_run"), ...listed]);
  const outcome = applyMigration(ctx.runtime, paths, plan);
  if (outcome === "mismatch" || outcome === "write_failed")
    return failureFrom(ctx.t, {
      code: "internal_error",
      messageKey: DONE[outcome],
      params: {},
      fix: USAGE,
      exitCode: ExitCode.Internal,
    });
  return success({ ...data, converted: outcome === "converted" }, [...listed, ctx.t(DONE[outcome])]);
};

export const conceitosMigrateCommand: CommandSpec = {
  path: ["conceitos", "migrate"],
  summaryKey: "command.conceitos_migrate.summary",
  usage: USAGE,
  status: "ready",
  run: (ctx) => Promise.resolve(migrate(ctx)),
};

export const CONCEITOS_COMMANDS: readonly CommandSpec[] = [
  conceitosCommand,
  conceitosExportCommand,
  conceitosUpdateCommand,
  conceitosMarkCommand,
  conceitosMigrateCommand,
];
