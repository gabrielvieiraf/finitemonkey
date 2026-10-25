import { failureFrom } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import type { MessageKey } from "../i18n/catalogs.js";
import type { CommandSpec, OptionsConfig } from "./types.js";

const planned = (name: string, summaryKey: MessageKey, options: OptionsConfig): CommandSpec => ({
  path: [name],
  summaryKey,
  usage: `finitemonkey ${name}`,
  status: "planned",
  options,
  maxPositionals: 8,
  run: (ctx) =>
    Promise.resolve(
      failureFrom(ctx.t, {
        code: "not_implemented",
        messageKey: "error.not_implemented",
        params: { command: name },
        fix: "finitemonkey help",
        exitCode: ExitCode.Usage,
        data: { command: name, status: "planned" },
      }),
    ),
});

export const initCommand = planned("init", "command.init.summary", {
  preset: { type: "string" },
  github: { type: "boolean" },
});

export const updateCommand = planned("update", "command.update.summary", { check: { type: "boolean" } });

export const uninstallCommand = planned("uninstall", "command.uninstall.summary", {
  purge: { type: "boolean" },
  "keep-generated": { type: "boolean" },
});
