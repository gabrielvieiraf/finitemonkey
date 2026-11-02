import { basename } from "node:path";

import { commandEffect, type EffectContext } from "../approve/effect.js";
import { looksLikeTest } from "../gate/test-pin.js";
import { normalizeCommand } from "../shell/normalize.js";
import type { Dialect, ShellCommand } from "../shell/types.js";

const FM: ReadonlySet<string> = new Set(["finitemonkey", "fm"]);

const programOf = (command: ShellCommand): string => basename(command.program.replace(/\\/g, "/")).toLowerCase();

const writesFile = (command: ShellCommand): boolean =>
  command.redirects.some((item) => item.op.includes(">") && !/^\/dev\/null$/i.test(item.target));

const fmArgs = (command: ShellCommand): readonly string[] | undefined => {
  const program = programOf(command);
  if (FM.has(program)) return command.args;
  if (program === "node" && (command.args[0] ?? "").endsWith("finitemonkey.mjs")) return command.args.slice(1);
  return undefined;
};

const isCritiqueVerify = (command: ShellCommand): boolean => {
  const args = fmArgs(command);
  const words = args?.filter((arg) => !arg.startsWith("-")) ?? [];
  return words[0] === "critique" && words[1] === "verify" && !writesFile(command);
};

const UPDATES = /^(?:-u|--update|--updateSnapshot|--update-snapshots|--snapshot-update|--write)$/;

const isTestRun = (command: ShellCommand): boolean =>
  !writesFile(command) &&
  !command.args.some((arg) => UPDATES.test(arg)) &&
  looksLikeTest([command.program, ...command.args].join(" "));

const shown = (command: ShellCommand): string => [command.program, ...command.args].join(" ").slice(0, 160);

export const readOnlyViolation = (text: string, dialect: Dialect, context: EffectContext): string | undefined => {
  const parsed = normalizeCommand(text, dialect);
  if (parsed.incomplete || parsed.commands.length === 0) return text.slice(0, 160);
  for (const command of parsed.commands) {
    if (isCritiqueVerify(command) || isTestRun(command)) continue;
    if (commandEffect(command, context).effect !== "reads") return shown(command);
  }
  return undefined;
};
