import type { Dialect } from "./types.js";
import { POWERSHELLS, SHELL_WITH_VALUE, SHELLS, WRAPPERS, type WrapperSpec } from "./wrappers.js";

export interface Stage {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly via: readonly string[];
}

export type Unwrapped =
  | { readonly kind: "command"; readonly stage: Stage; readonly extra: readonly Stage[] }
  | { readonly kind: "script"; readonly script: string; readonly dialect: Dialect | "cmd"; readonly stage: Stage }
  | { readonly kind: "none" };

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
const EXECUTABLE_SUFFIX = /\.(?:exe|cmd|bat|com)$/i;
const MAX_LAYERS = 16;

export const programName = (word: string): string => {
  const base = word.split(/[\\/]/).pop() ?? word;
  return EXECUTABLE_SUFFIX.test(base) ? base.replace(EXECUTABLE_SUFFIX, "").toLowerCase() : base;
};

const withAssignments = (stage: Stage): Stage => {
  const env: Record<string, string> = { ...stage.env };
  let index = 0;
  for (; index < stage.argv.length; index += 1) {
    const match = ASSIGNMENT.exec(stage.argv[index] ?? "");
    if (match === null) break;
    env[match[1] ?? ""] = match[2] ?? "";
  }
  return { ...stage, argv: stage.argv.slice(index), env };
};

const skipOptions = (args: readonly string[], wrapper: WrapperSpec): number | undefined => {
  let index = 0;
  while (index < args.length) {
    const arg = args[index] ?? "";
    if (arg === "--") return index + 1 + wrapper.positionals;
    if (!arg.startsWith("-") || arg === "-") break;
    if (wrapper.queries.has(arg)) return undefined;
    index += wrapper.withValue.has(arg) ? 2 : 1;
  }
  return index + wrapper.positionals;
};

const shift = (stage: Stage, count: number, name: string): Stage => ({
  ...stage,
  argv: stage.argv.slice(count),
  via: [...stage.via, name],
});

const envCommand = (stage: Stage): Stage | Unwrapped => {
  let index = 1;
  while (index < stage.argv.length && (stage.argv[index] ?? "").startsWith("-")) {
    const arg = stage.argv[index] ?? "";
    if (arg === "-S" || arg === "--split-string") {
      return { kind: "script", script: stage.argv.slice(index + 1).join(" "), dialect: "bash", stage };
    }
    if (arg === "--") {
      index += 1;
      break;
    }
    index += arg === "-u" || arg === "-C" || arg === "--unset" || arg === "--chdir" ? 2 : 1;
  }
  return shift(stage, index, "env");
};

const shellScript = (stage: Stage, name: string, stdin: string | undefined): Unwrapped | undefined => {
  const args = stage.argv.slice(1);
  let index = 0;
  let command = false;
  while (index < args.length && /^[-+]/.test(args[index] ?? "")) {
    const arg = args[index] ?? "";
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(arg)) command = true;
    index += SHELL_WITH_VALUE.has(arg) ? 2 : 1;
  }
  const script = args[index];
  if (command && script !== undefined) return { kind: "script", script, dialect: "bash", stage: shift(stage, 0, name) };
  if (script === undefined && stdin !== undefined) return { kind: "script", script: stdin, dialect: "bash", stage };
  return undefined;
};

const decodeEncoded = (value: string): string => Buffer.from(value, "base64").toString("utf16le");

const powershellScript = (stage: Stage, name: string): Unwrapped | undefined => {
  const args = stage.argv.slice(1);
  const at = args.findIndex((arg) => /^[-/](?:c|co|com|comm|comma|comman|command)$/i.test(arg));
  const encoded = args.findIndex((arg) => /^[-/](?:e|ec|enc|encodedcommand)$/i.test(arg));
  if (at >= 0) {
    return {
      kind: "script",
      script: args.slice(at + 1).join(" "),
      dialect: "powershell",
      stage: shift(stage, 0, name),
    };
  }
  const value = encoded >= 0 ? args[encoded + 1] : undefined;
  if (value !== undefined) {
    return { kind: "script", script: decodeEncoded(value), dialect: "powershell", stage: shift(stage, 0, name) };
  }
  return undefined;
};

const cmdScript = (stage: Stage): Unwrapped | undefined => {
  const at = stage.argv.findIndex((arg, index) => index > 0 && /^\/[ck]$/i.test(arg));
  if (at < 0) return undefined;
  return { kind: "script", script: stage.argv.slice(at + 1).join(" "), dialect: "cmd", stage: shift(stage, 0, "cmd") };
};

const findExec = (stage: Stage): readonly Stage[] => {
  const extra: Stage[] = [];
  stage.argv.forEach((arg, index) => {
    if (!["-exec", "-execdir", "-ok", "-okdir"].includes(arg)) return;
    const rest = stage.argv.slice(index + 1);
    const end = rest.findIndex((word) => word === ";" || word === "+");
    extra.push({ ...stage, argv: end < 0 ? rest : rest.slice(0, end), via: [...stage.via, "find -exec"] });
  });
  return extra;
};

type Step = { readonly next: Stage } | { readonly done: Unwrapped };

const step = (stage: Stage, stdin: string | undefined): Step => {
  const name = programName(stage.argv[0] ?? "");
  const lower = name.toLowerCase();
  if (name === "env") {
    const result = envCommand(stage);
    return "kind" in result ? { done: result } : { next: result };
  }
  if (name === "busybox") return { next: shift(stage, 1, name) };
  const wrapper = WRAPPERS[name];
  if (wrapper !== undefined) {
    const skip = skipOptions(stage.argv.slice(1), wrapper);
    return skip === undefined ? { done: { kind: "none" } } : { next: shift(stage, 1 + skip, name) };
  }
  if (name === "eval")
    return { done: { kind: "script", script: stage.argv.slice(1).join(" "), dialect: "bash", stage } };
  const script = SHELLS.has(name)
    ? shellScript(stage, name, stdin)
    : POWERSHELLS.has(lower)
      ? powershellScript(stage, name)
      : lower === "cmd"
        ? cmdScript(stage)
        : undefined;
  if (script !== undefined) return { done: script };
  return { done: { kind: "command", stage, extra: name === "find" ? findExec(stage) : [] } };
};

export const unwrap = (initial: Stage, stdin: string | undefined): Unwrapped => {
  let stage = initial;
  for (let layer = 0; layer < MAX_LAYERS; layer += 1) {
    stage = withAssignments(stage);
    if (stage.argv.length === 0) return { kind: "none" };
    const result = step(stage, stdin);
    if ("done" in result) return result.done;
    stage = result.next;
  }
  return { kind: "command", stage, extra: [] };
};
