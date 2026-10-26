import type { ShellCommand } from "../shell/types.js";

export interface GitInvocation {
  readonly dirs: readonly string[];
  readonly config: Readonly<Record<string, string>>;
  readonly subcommand: string;
  readonly args: readonly string[];
  readonly command: ShellCommand;
}

const WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "--super-prefix",
  "--config-env",
  "--attr-source",
]);

interface Globals {
  readonly dirs: string[];
  readonly config: Record<string, string>;
}

const addConfig = (globals: Globals, entry: string): void => {
  const equals = entry.indexOf("=");
  const key = (equals < 0 ? entry : entry.slice(0, equals)).toLowerCase();
  globals.config[key] = equals < 0 ? "true" : entry.slice(equals + 1);
};

const globalOption = (globals: Globals, name: string, value: string): void => {
  if (name === "-C") globals.dirs.push(value);
  else if (name === "-c") addConfig(globals, value);
  else if (name === "--work-tree") globals.dirs.push(value);
};

export const gitInvocation = (command: ShellCommand): GitInvocation | undefined => {
  if (command.program !== "git") return undefined;
  const globals: Globals = { dirs: [], config: {} };
  const { args } = command;
  let index = 0;
  while (index < args.length && (args[index] ?? "").startsWith("-")) {
    const arg = args[index] ?? "";
    const equals = arg.indexOf("=");
    const name = equals > 2 && arg.startsWith("--") ? arg.slice(0, equals) : arg;
    if (WITH_VALUE.has(name) && equals < 0) {
      globalOption(globals, name, args[index + 1] ?? "");
      index += 2;
    } else {
      if (equals > 0) globalOption(globals, name, arg.slice(equals + 1));
      index += 1;
    }
  }
  return {
    dirs: globals.dirs,
    config: globals.config,
    subcommand: args[index] ?? "",
    args: args.slice(index + 1),
    command,
  };
};

export const withAlias = (invocation: GitInvocation, expansion: readonly string[]): GitInvocation => ({
  ...invocation,
  subcommand: expansion[0] ?? "",
  args: [...expansion.slice(1), ...invocation.args],
});
