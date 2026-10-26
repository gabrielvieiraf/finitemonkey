import { win32 } from "node:path";

import type { Env } from "./context.js";

export interface WindowsCommand {
  readonly command: string;
  readonly shell: boolean;
}

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";
const NEEDS_SHELL = /\.(cmd|bat)$/i;
const NEEDS_QUOTES = /[\s"&|<>^()%!]/;

const envValue = (env: Env, name: string): string | undefined => {
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
};

export const quoteForCmd = (arg: string): string =>
  arg !== "" && !NEEDS_QUOTES.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`;

export const resolveWindowsCommand = (command: string, env: Env, exists: (path: string) => boolean): WindowsCommand => {
  if (/[\\/]/.test(command) || win32.extname(command) !== "") {
    return { command, shell: NEEDS_SHELL.test(command) };
  }
  const dirs = (envValue(env, "PATH") ?? "").split(";").filter((dir) => dir !== "");
  const extensions = (envValue(env, "PATHEXT") ?? DEFAULT_PATHEXT).split(";").filter((ext) => ext !== "");
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = win32.join(dir, `${command}${ext.toLowerCase()}`);
      if (exists(candidate)) return { command: candidate, shell: NEEDS_SHELL.test(candidate) };
    }
  }
  return { command, shell: false };
};

export const windowsCommandLine = (resolved: WindowsCommand, args: readonly string[]): string =>
  [quoteForCmd(resolved.command), ...args.map(quoteForCmd)].join(" ");
