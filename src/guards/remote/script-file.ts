import { join } from "node:path";

import { type CodeCall, codeCall } from "./code.js";
import { type RemoteCall, SCRIPT_RUNNERS, shellCommands, TARGET_LIMIT } from "./http.js";

export type ScriptReader = (path: string) => string | undefined;

export interface ScriptFileCall extends CodeCall {
  readonly file: string;
  readonly target: string;
}

const SCRIPT_FILE = /\.(?:py|js|mjs|cjs|ts|mts|cts|rb)$/i;
const INLINE_FLAGS = new Set(["-c", "-e", "--eval", "-m"]);

const scriptPaths = (call: RemoteCall): readonly string[] =>
  shellCommands(call).flatMap((command) => {
    if (!SCRIPT_RUNNERS.has(command.program)) return [];
    if (command.args.some((arg) => INLINE_FLAGS.has(arg))) return [];
    const file = command.args.find((arg) => !arg.startsWith("-") && SCRIPT_FILE.test(arg));
    if (file === undefined) return [];
    return [command.dir === undefined ? file : join(command.dir, file)];
  });

export const scriptFileCall = (call: RemoteCall, read: ScriptReader): ScriptFileCall | undefined => {
  for (const file of scriptPaths(call)) {
    const code = read(file);
    const found = code === undefined ? undefined : codeCall(code);
    if (found !== undefined) return { ...found, file, target: `${file}: ${found.url}`.slice(0, TARGET_LIMIT) };
  }
  return undefined;
};
