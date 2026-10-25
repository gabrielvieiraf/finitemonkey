import { failureFrom } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import type { MessageKey } from "../i18n/catalogs.js";
import type { CommandSpec, OptionsConfig } from "./types.js";

export const planned = (name: string, summaryKey: MessageKey, options: OptionsConfig): CommandSpec => ({
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
