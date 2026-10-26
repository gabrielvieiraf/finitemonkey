import { normalizeCommand } from "../shell/normalize.js";

export interface SimpleCommand {
  readonly env: Readonly<Record<string, string>>;
  readonly argv: readonly string[];
  readonly redirects: readonly string[];
}

const HEREDOC = /^<<[-<]?$/;

export const parseShell = (text: string): readonly SimpleCommand[] =>
  normalizeCommand(text).commands.map((command) => ({
    env: command.env,
    argv: command.program === "" ? [] : [command.program, ...command.args],
    redirects: command.redirects.filter((redirect) => !HEREDOC.test(redirect.op)).map((redirect) => redirect.target),
  }));
