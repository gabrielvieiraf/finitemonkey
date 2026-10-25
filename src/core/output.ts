import { ExitCode } from "../exit-codes.js";
import type { Translate } from "../i18n/translate.js";
import type { Ctx } from "./context.js";
import { FmError } from "./problem.js";
import { type CommandResult, failureFrom, type FailureResult, toEnvelope } from "./result.js";

export const ISSUES_URL = "https://github.com/gabrielvieiraf/finitemonkey/issues";

export const resultFromThrown = (thrown: unknown, t: Translate): FailureResult => {
  if (thrown instanceof FmError) return failureFrom(t, thrown.problem);
  const detail = thrown instanceof Error ? thrown.message : String(thrown);
  return failureFrom(t, {
    code: "internal_error",
    messageKey: "error.internal",
    params: { detail },
    fix: ISSUES_URL,
    exitCode: ExitCode.Internal,
  });
};

const block = (items: readonly string[]): string => (items.length > 0 ? `${items.join("\n")}\n` : "");

export const render = (ctx: Ctx, command: string, result: CommandResult): void => {
  if (result.raw !== undefined) {
    ctx.io.stdout.write(result.raw.stdout);
    ctx.io.stderr.write(result.raw.stderr);
    return;
  }
  if (ctx.json) {
    ctx.io.stdout.write(`${JSON.stringify(toEnvelope(command, result))}\n`);
    return;
  }
  ctx.io.stdout.write(block(result.human ?? []));
  if (!result.ok) {
    const { message, fix } = result.error;
    ctx.io.stderr.write(block([ctx.t("output.error", { message }), ctx.t("output.fix", { fix })]));
  }
  if (result.next !== undefined) ctx.io.stdout.write(block([ctx.t("output.next", { next: result.next })]));
};
