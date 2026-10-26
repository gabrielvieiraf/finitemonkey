import type { ShellCommand } from "../shell/types.js";

const MAX_SHOWN = 160;

export const shown = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_SHOWN ? `${flat.slice(0, MAX_SHOWN - 3)}...` : flat;
};

export const commandText = (command: ShellCommand): string => shown([command.program, ...command.args].join(" "));
