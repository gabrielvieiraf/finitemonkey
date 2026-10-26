import { isOwnHandler } from "../install/hook-entries.js";
import { entriesOf, projectHookFiles } from "./hook-sources.js";
import { type Check, finding } from "./types.js";

const seesShell = (matcher: string | undefined): boolean =>
  matcher === undefined || matcher === "" || matcher === "*" || /\b(Bash|PowerShell)\b/.test(matcher);

const nameOf = (handler: Readonly<Record<string, unknown>>): string => {
  const command = handler["command"];
  return typeof command === "string" ? (command.split(/\s+/)[0] ?? command).slice(0, 60) : "?";
};

export const checkRewriters: Check = (env) => {
  const foreign = projectHookFiles(env)
    .flatMap((file) => entriesOf(file.source, file.hooks, (handler) => !isOwnHandler(handler)))
    .filter((entry) => entry.event === "PreToolUse" && seesShell(entry.matcher));
  if (foreign.length === 0) return [];
  const list = [...new Set(foreign.map((entry) => nameOf(entry.handler)))].join(", ");
  return [
    finding(
      "hooks.rewriters",
      "warn",
      "doctor.hooks.rewriters",
      { hooks: foreign.length, list },
      "doctor.hooks.fix_rewriters",
    ),
  ];
};
