import { toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import type { ShellCommand } from "../shell/types.js";
import { isRootLike, isWithin, pathKey, resolveFrom } from "./path-key.js";
import { block, type GitVerdict, PASS } from "./verdict.js";

const RECURSIVE_SHORT = /^-[A-Za-z]*[rR][A-Za-z]*$/;
const PS_RECURSE = /^-r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?$/i;
const PS_VALUE_PARAMS = ["filter", "include", "exclude", "credential", "stream"] as const;
const GLOB = /[*?[]/;
const UNSET_PREFIX = /^\$(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*]|\{(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+|[@*])(?::?-[^}]*)?\})\//;

export interface RmContext {
  readonly cwd: string;
  readonly home: string | undefined;
  readonly worktrees: () => readonly string[];
}

const posixTargets = (command: ShellCommand): readonly string[] | undefined => {
  const dashdash = command.args.indexOf("--");
  const options = dashdash < 0 ? command.args : command.args.slice(0, dashdash);
  const recursive = options.some((arg) => RECURSIVE_SHORT.test(arg) || arg === "--recursive");
  if (!recursive) return undefined;
  const operands = options.filter((arg) => !arg.startsWith("-"));
  return dashdash < 0 ? operands : [...operands, ...command.args.slice(dashdash + 1)];
};

const takesValue = (previous: string): boolean => {
  const name = previous.startsWith("-") ? previous.slice(1).toLowerCase() : "";
  return name.length >= 2 && PS_VALUE_PARAMS.some((param) => param.startsWith(name));
};

const powershellTargets = (command: ShellCommand): readonly string[] | undefined => {
  const recursive = command.args.some((arg) => PS_RECURSE.test(arg) || /^\/s$/i.test(arg));
  if (!recursive) return undefined;
  return command.args.flatMap((arg, index) => {
    if (arg.startsWith("-") || /^\/[a-z]$/i.test(arg)) return [];
    return takesValue(command.args[index - 1] ?? "") ? [] : arg.split(",");
  });
};

export const removalTargets = (command: ShellCommand): readonly string[] | undefined => {
  if (command.program === "rm") return posixTargets(command);
  if (command.program === "remove-item") return powershellTargets(command);
  return undefined;
};

const globBase = (target: string): string => {
  const at = target.search(GLOB);
  if (at < 0) return target;
  const slash = target.lastIndexOf("/", at);
  return slash < 0 ? "." : target.slice(0, slash) || "/";
};

const containsGitDir = (runtime: Runtime, path: string): boolean =>
  runtime.stat(toAbsolutePath(resolveFrom(path, ".git"))) !== undefined;

const targetVerdict = (runtime: Runtime, context: RmContext, command: ShellCommand, raw: string): GitVerdict => {
  if (raw.startsWith("$") || raw.startsWith("~") || raw.startsWith("%")) {
    return /^~\/*\*?$/.test(raw) || UNSET_PREFIX.test(raw) ? block("rm-root", raw) : PASS;
  }
  if (/(?:^|\/)\.git\/?$/.test(raw.replace(/\\/g, "/"))) return block("rm-worktree", raw);
  const glob = GLOB.test(raw);
  const path = resolveFrom(context.cwd, command.dir, glob ? globBase(raw) : raw);
  const real = runtime.realpath(path);
  if (isRootLike(real, context.home) || isRootLike(path, context.home)) return block("rm-root", raw);
  const worktree = context.worktrees().find((tree) => isWithin(tree, real) || isWithin(tree, path));
  if (worktree !== undefined) return block("rm-worktree", raw);
  if (!glob && containsGitDir(runtime, real)) return block("rm-worktree", raw);
  return PASS;
};

export const rmVerdict = (runtime: Runtime, context: RmContext, command: ShellCommand): GitVerdict => {
  const targets = removalTargets(command);
  if (targets === undefined) return PASS;
  for (const target of targets) {
    const verdict = targetVerdict(runtime, context, command, target);
    if (verdict.kind === "block") return verdict;
  }
  return PASS;
};

export const listWorktrees = (runtime: Runtime, cwd: string): readonly string[] => {
  const listed = runtime.git(["worktree", "list", "--porcelain"], toAbsolutePath(cwd));
  if (!listed.ok) return [];
  return listed.stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => pathKey(line.slice("worktree ".length)));
};
