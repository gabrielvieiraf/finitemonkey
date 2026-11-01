import type { SimpleCommand } from "../shell.js";

export interface RestoreSpec {
  readonly source: string | undefined;
  readonly paths: readonly string[];
}

const NOT_RESTORE = new Set(["-b", "-B", "--orphan", "-p", "--patch", "-m", "--merge", "--conflict"]);

const split = (args: readonly string[]): { readonly before: readonly string[]; readonly after: readonly string[] } => {
  const index = args.indexOf("--");
  return index < 0 ? { before: args, after: [] } : { before: args.slice(0, index), after: args.slice(index + 1) };
};

const positionals = (args: readonly string[]): readonly string[] => args.filter((arg) => !arg.startsWith("-"));

const checkoutSpec = (args: readonly string[], isTree: (rev: string) => boolean): RestoreSpec | undefined => {
  const { before, after } = split(args);
  if (before.some((arg) => NOT_RESTORE.has(arg.split("=")[0] ?? arg))) return undefined;
  const named = positionals(before);
  if (args.includes("--")) {
    if (named.length > 1) return undefined;
    return { source: named[0], paths: after };
  }
  const first = named[0];
  if (first !== undefined && named.length > 1 && isTree(first)) return { source: first, paths: named.slice(1) };
  return { source: undefined, paths: named };
};

const restoreSource = (args: readonly string[]): string | undefined => {
  const index = args.findIndex((arg) => arg === "-s" || arg === "--source");
  if (index >= 0) return args[index + 1];
  const joined = args.find((arg) => arg.startsWith("--source=") || /^-s./.test(arg));
  if (joined === undefined) return undefined;
  return joined.startsWith("--source=") ? joined.slice("--source=".length) : joined.slice(2);
};

const restoreSpec = (args: readonly string[]): RestoreSpec | undefined => {
  const { before, after } = split(args);
  if (before.some((arg) => NOT_RESTORE.has(arg.split("=")[0] ?? arg))) return undefined;
  const staged = before.includes("--staged") || before.includes("-S");
  const worktree = before.includes("--worktree") || before.includes("-W");
  const source = restoreSource(before) ?? (staged && worktree ? "HEAD" : undefined);
  const valued = new Set([source]);
  const named = positionals(before).filter((arg) => !valued.has(arg));
  return { source, paths: [...named, ...after] };
};

export const restoreOf = (command: SimpleCommand, isTree: (rev: string) => boolean): RestoreSpec | undefined => {
  const [name = "", ...args] = command.argv;
  if (name !== "git") return undefined;
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "checkout") return checkoutSpec(rest, isTree);
  if (sub === "restore") return restoreSpec(rest);
  return undefined;
};
