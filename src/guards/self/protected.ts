import { relative } from "node:path";

import type { AbsolutePath } from "../../core/brand.js";
import { toPosixPath } from "../../core/posix-path.js";
import { fmArguments } from "../bypass/detect.js";
import { parseShell, type SimpleCommand } from "../shell.js";

export const SELF_KINDS = ["policy", "allow_store", "registry", "amend", "examples"] as const;

export type SelfKind = (typeof SELF_KINDS)[number];

const REGISTRY = /\.git\/(?:worktrees\/[^/]+\/)?finitemonkey(\/|$)/;

const normalize = (path: string): string => toPosixPath(path).replace(/^\.\//, "");

export const selfTarget = (root: AbsolutePath, path: string): SelfKind | undefined => {
  const raw = normalize(path);
  const local = raw.startsWith("/") || /^[A-Za-z]:\//.test(raw) ? normalize(relative(root, path)) : raw;
  if (REGISTRY.test(raw) || REGISTRY.test(local)) return "registry";
  if (/(^|\/)\.finitemonkey\/reports\/[^/]+\.json$/.test(local)) return undefined;
  const inFm = /(^|\/)\.finitemonkey(\/|$)/.test(local);
  if (inFm && /(^|\/)\.finitemonkey\/allow(\/|$)/.test(local)) return "allow_store";
  if (inFm || /(^|\/)\.gitleaksignore$/.test(local)) return "policy";
  return undefined;
};

const WRITERS = new Set([
  "rm",
  "rmdir",
  "mv",
  "cp",
  "touch",
  "truncate",
  "tee",
  "ln",
  "install",
  "chmod",
  "chown",
  "unlink",
  "dd",
  "rsync",
  "mkdir",
]);
const COPIERS = new Set(["cp", "install", "rsync", "ln"]);
const IN_PLACE = new Set(["sed", "perl", "ruby"]);
const INTERPRETERS = new Set(["node", "python", "python3", "ruby", "perl", "deno", "bun", "php"]);
const GIT_WRITERS = new Set(["checkout", "restore", "rm", "mv", "clean", "stash", "apply", "reset"]);
const FM_NAMES = new Set(["finitemonkey", "fm"]);

const inline = (argv: readonly string[]): boolean =>
  argv.some((arg) => arg === "-e" || arg === "-c" || arg === "--eval");

export const writtenPaths = (command: SimpleCommand): readonly string[] => {
  const [name = "", ...args] = command.argv;
  const operands = args.filter((arg) => !arg.startsWith("-"));
  const ddTargets = args.filter((arg) => arg.startsWith("of=")).map((arg) => arg.slice(3));
  if (FM_NAMES.has(name)) return command.redirects;
  if (COPIERS.has(name)) return [...command.redirects, ...operands.slice(-1)];
  if (WRITERS.has(name)) return [...command.redirects, ...operands, ...ddTargets];
  if (IN_PLACE.has(name) && args.some((arg) => /^-[a-zA-Z]*i/.test(arg) || arg.startsWith("--in-place"))) {
    return [...command.redirects, ...operands];
  }
  if (INTERPRETERS.has(name) && inline(args)) return [...command.redirects, ...args];
  if (name === "git" && GIT_WRITERS.has(operands[0] ?? "")) return [...command.redirects, ...operands.slice(1)];
  return command.redirects;
};

const FRONT_REPORT = /\.finitemonkey[\\/]reports[\\/][^\\/]+\.json$/;

const mentioned = (text: string): SelfKind | undefined => {
  if (FRONT_REPORT.test(text)) return undefined;
  if (/\.git[\\/]finitemonkey/.test(text)) return "registry";
  if (/\.finitemonkey[\\/]allow/.test(text)) return "allow_store";
  if (/\.finitemonkey|\.gitleaksignore/.test(text)) return "policy";
  return undefined;
};

const PERSON_DECISIONS = new Set(["--approve", "--reject"]);

const PERSON_CHOICES = new Set(["--choose"]);

const flagIn = (args: readonly string[], flags: ReadonlySet<string>): boolean =>
  args.some((arg) => flags.has(arg.split("=")[0] ?? ""));

const decidesExamples = (args: readonly string[]): boolean =>
  args[0] === "task" &&
  ((args[1] === "examples" && flagIn(args, PERSON_DECISIONS)) ||
    (args[1] === "diverge" && flagIn(args, PERSON_CHOICES)));

const amends = (command: SimpleCommand): readonly { readonly kind: SelfKind; readonly path: string }[] => {
  const args = fmArguments(command.argv);
  if (args === undefined) return [];
  if (args[0] === "task" && args[1] === "amend") return [{ kind: "amend", path: "finitemonkey task amend" }];
  return decidesExamples(args) ? [{ kind: "examples", path: "finitemonkey task examples" }] : [];
};

export const bashSelfTargets = (
  root: AbsolutePath,
  commandLine: string,
): readonly { readonly kind: SelfKind; readonly path: string }[] =>
  parseShell(commandLine).flatMap((command) => [
    ...writtenPaths(command).flatMap((path) => {
      const kind = selfTarget(root, path) ?? mentioned(path);
      return kind === undefined ? [] : [{ kind, path }];
    }),
    ...amends(command),
  ]);
