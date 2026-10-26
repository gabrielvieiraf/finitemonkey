import { posix } from "node:path";

import { toPosixPath } from "../core/posix-path.js";
import { lexBash } from "./lexer.js";
import { type RawCommand, rawCommands } from "./parse.js";
import { lexPowerShell, powershellProgram } from "./powershell.js";
import type { Dialect, Lexed, Normalized, Segment, ShellCommand } from "./types.js";
import { programName, type Stage, unwrap } from "./unwrap.js";

type Language = Dialect | "cmd";

interface Context {
  env: Readonly<Record<string, string>>;
  dir: string | undefined;
  readonly via: readonly string[];
}

interface Collector {
  readonly out: ShellCommand[];
  incomplete: boolean;
}

const MAX_DEPTH = 8;
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
const PS_ENV = /^\$env:([A-Za-z_][A-Za-z0-9_]*)=?(.*)$/is;
const CHANGES_DIR = new Set(["cd", "pushd", "set-location", "push-location"]);

const lex = (text: string, language: Language): Lexed =>
  language === "bash" ? lexBash(text) : lexPowerShell(text, language === "cmd");

const isWindowsAbsolute = (path: string): boolean => /^[A-Za-z]:\//.test(path);

const joinDir = (current: string | undefined, target: string): string => {
  const next = toPosixPath(target);
  if (next.startsWith("/") || isWindowsAbsolute(next) || next.startsWith("~")) return next;
  return current === undefined ? posix.normalize(next) : posix.join(current, next);
};

const assignments = (words: readonly string[], language: Language): Record<string, string> | undefined => {
  if (language !== "bash") {
    const [first, second, third] = words;
    const match = first === undefined ? null : PS_ENV.exec(first);
    if (match === null) return undefined;
    const value = second === "=" ? (third ?? "") : (match[2] ?? "");
    return { [match[1] ?? ""]: value };
  }
  const list = words[0] === "export" || words[0] === "declare" ? words.slice(1) : words;
  if (list.length === 0 || !list.every((word) => ASSIGNMENT.test(word) || word.startsWith("-"))) return undefined;
  const found = list.flatMap((word) => {
    const match = ASSIGNMENT.exec(word);
    return match === null ? [] : [[match[1] ?? "", match[2] ?? ""] as const];
  });
  return found.length === 0 ? undefined : Object.fromEntries(found);
};

const track = (words: readonly string[], language: Language, context: Context): void => {
  const assigned = assignments(words, language);
  if (assigned !== undefined) context.env = { ...context.env, ...assigned };
  const program = language === "bash" ? (words[0] ?? "") : powershellProgram(words[0] ?? "");
  if (!CHANGES_DIR.has(program)) return;
  const target = words.slice(1).find((word) => !word.startsWith("-"));
  context.dir = target === undefined || target === "-" ? "~" : joinDir(context.dir, target);
};

const emit = (stage: Stage, raw: RawCommand, language: Language, context: Context, collector: Collector): void => {
  const first = stage.argv[0] ?? "";
  const name = programName(first);
  collector.out.push({
    program: language === "bash" ? name : powershellProgram(name),
    args: stage.argv.slice(1),
    env: stage.env,
    redirects: raw.redirects,
    stdin: raw.stdin,
    dir: context.dir,
    via: stage.via,
    dynamic: raw.words.some((word) => word.dynamic),
  });
};

const emptyCommand = (raw: RawCommand, context: Context): ShellCommand => ({
  program: "",
  args: [],
  env: context.env,
  redirects: raw.redirects,
  stdin: raw.stdin,
  dir: context.dir,
  via: context.via,
  dynamic: false,
});

const visit = (raw: RawCommand, language: Language, context: Context, depth: number, collector: Collector): void => {
  const words = raw.words.map((word) => word.text);
  track(words, language, context);
  const result = unwrap({ argv: words, env: context.env, via: context.via }, raw.stdin);
  if (result.kind === "none") {
    if (raw.redirects.length > 0) collector.out.push(emptyCommand(raw, context));
    return;
  }
  if (result.kind === "script") {
    const nested: Context = { env: result.stage.env, dir: context.dir, via: result.stage.via };
    collect(result.script, result.dialect, nested, depth + 1, collector);
    return;
  }
  emit(result.stage, raw, language, context, collector);
  for (const extra of result.extra) emit(extra, raw, language, context, collector);
};

const collect = (text: string, language: Language, context: Context, depth: number, collector: Collector): void => {
  if (depth > MAX_DEPTH) {
    collector.incomplete = true;
    return;
  }
  const lexed = lex(text, language);
  if (lexed.incomplete) collector.incomplete = true;
  for (const substitution of lexed.substitutions) {
    collect(substitution, language, { ...context }, depth + 1, collector);
  }
  for (const raw of rawCommands(lexed.tokens)) visit(raw, language, context, depth, collector);
};

export const normalizeCommand = (text: string, dialect: Dialect = "bash"): Normalized => {
  const collector: Collector = { out: [], incomplete: false };
  collect(text, dialect, { env: {}, dir: undefined, via: [] }, 0, collector);
  return { commands: collector.out, incomplete: collector.incomplete };
};

export const dialectOf = (toolName: string): Dialect => (toolName === "PowerShell" ? "powershell" : "bash");

export const segmentsOf = (command: string): readonly Segment[] =>
  normalizeCommand(command).commands.map((item) => ({
    program: item.program,
    args: item.args,
    redirectedFrom: item.redirects.filter((redirect) => redirect.op === "<").map((redirect) => redirect.target),
  }));
