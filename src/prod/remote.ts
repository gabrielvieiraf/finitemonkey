import type { ShellCommand } from "../shell/types.js";

const SSH_VALUE = "bcDEeFIiJLlmOopQRSWwB";
const SCP_VALUE = "cFiJloPSX";
const RSYNC_LONG_VALUE = new Set(["--rsh", "--rsync-path", "--filter", "--exclude", "--include", "--port", "--password-file", "--chmod", "--log-file", "--exclude-from", "--include-from", "--files-from"]);

export interface SshCall {
  readonly destination: string;
  readonly remote: readonly string[];
  readonly noCommand: boolean;
}

export const parseSsh = (command: ShellCommand): SshCall | undefined => {
  const { args } = command;
  let index = 0;
  let noCommand = false;
  while (index < args.length && (args[index] ?? "").startsWith("-")) {
    const arg = args[index] ?? "";
    if (arg === "--") {
      index += 1;
      break;
    }
    if (arg.includes("N")) noCommand = true;
    const last = arg.charAt(arg.length - 1);
    index += arg.length === 2 && SSH_VALUE.includes(last) ? 2 : 1;
  }
  const destination = args[index];
  if (destination === undefined) return undefined;
  return { destination: destination.replace(/^ssh:\/\//, ""), remote: args.slice(index + 1), noCommand };
};

const REMOTE_PATH = /^(?:(?:scp|rsync|sftp):\/\/)?(?:[^@/:\s]+@)?(\[[^\]]+\]|[A-Za-z0-9][A-Za-z0-9.-]*)(?::|::|\/)/;

export const remoteHostOf = (operand: string): string | undefined => {
  if (/^[A-Za-z]:[\\/]/.test(operand) || operand.startsWith("/") || operand.startsWith(".")) return undefined;
  const url = /^(?:scp|rsync|sftp):\/\//.test(operand);
  const match = REMOTE_PATH.exec(operand);
  if (match === null) return undefined;
  if (!url && !operand.slice(match[0].length - 1).startsWith(":")) return undefined;
  return (match[1] ?? "").replace(/^\[|\]$/g, "");
};

const copyOperands = (command: ShellCommand, shortValue: string): readonly string[] => {
  const out: string[] = [];
  for (let index = 0; index < command.args.length; index += 1) {
    const arg = command.args[index] ?? "";
    if (arg.startsWith("--")) {
      if (!arg.includes("=") && RSYNC_LONG_VALUE.has(arg)) index += 1;
    } else if (arg.startsWith("-") && arg.length > 1) {
      if (arg.length === 2 && shortValue.includes(arg.charAt(1))) index += 1;
    } else out.push(arg);
  }
  return out;
};

export interface CopyCall {
  readonly sources: readonly string[];
  readonly target: string | undefined;
}

export const parseCopy = (command: ShellCommand): CopyCall => {
  const operands = copyOperands(command, command.program === "scp" ? SCP_VALUE : "efTB");
  return { sources: operands.slice(0, -1), target: operands[operands.length - 1] };
};

export const remoteHostsOf = (command: ShellCommand): readonly string[] => {
  if (command.program === "ssh") {
    const call = parseSsh(command);
    return call === undefined ? [] : [call.destination];
  }
  if (command.program === "scp" || command.program === "rsync") {
    const call = parseCopy(command);
    return [...call.sources, ...(call.target === undefined ? [] : [call.target])].flatMap((operand) => {
      const host = remoteHostOf(operand);
      return host === undefined ? [] : [host];
    });
  }
  return [];
};
