import { parseShell, type SimpleCommand } from "../shell.js";

export const BYPASS_KINDS = ["no_verify", "hooks_path", "hook_env", "fm_allow", "fm_pause"] as const;

export type BypassKind = (typeof BYPASS_KINDS)[number];

export interface BypassFinding {
  readonly kind: BypassKind;
  readonly detail: string;
}

const HOOK_ENV =
  /^(HUSKY|HUSKY_SKIP_HOOKS|SKIP|LEFTHOOK|LEFTHOOK_EXCLUDE|PRE_COMMIT_ALLOW_NO_CONFIG|DCG_BYPASS|FINITEMONKEY_\w*)$/;
const GIT_VALUE_OPTIONS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "--config-env",
]);
const COMMIT_VALUE_SHORTS = new Set(["m", "F", "C", "c", "t"]);
const VERIFY_SUBCOMMANDS = new Set(["commit", "push", "merge", "am", "rebase", "cherry-pick", "revert", "pull"]);

const isHooksPath = (value: string): boolean => /^core\.hookspath(=|$)/i.test(value);

const envFindings = (command: SimpleCommand): readonly BypassFinding[] => {
  const pairs = Object.entries(command.env);
  const exported = command.argv[0] === "export" ? command.argv.slice(1).map((arg) => arg.split("=", 2)) : [];
  return [...pairs, ...exported]
    .filter(([name = ""]) => HOOK_ENV.test(name))
    .map(([name = "", value = ""]) => ({ kind: "hook_env" as const, detail: `${name}=${value}` }));
};

const splitGit = (
  args: readonly string[],
): { readonly globals: readonly string[]; readonly rest: readonly string[] } => {
  let index = 0;
  const globals: string[] = [];
  while (index < args.length && (args[index] ?? "").startsWith("-")) {
    const arg = args[index] ?? "";
    globals.push(arg);
    if (GIT_VALUE_OPTIONS.has(arg)) globals.push(args[index + 1] ?? "");
    index += GIT_VALUE_OPTIONS.has(arg) ? 2 : 1;
  }
  return { globals, rest: args.slice(index) };
};

const commitHasShortN = (args: readonly string[]): boolean => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--") return false;
    if (!/^-[A-Za-z]/.test(arg)) continue;
    for (const char of arg.slice(1)) {
      if (char === "n") return true;
      if (COMMIT_VALUE_SHORTS.has(char)) {
        if (arg.endsWith(char)) index += 1;
        break;
      }
    }
  }
  return false;
};

const gitFindings = (args: readonly string[]): readonly BypassFinding[] => {
  const { globals, rest } = splitGit(args);
  const found: BypassFinding[] = [];
  globals.forEach((arg, index) => {
    if ((arg === "-c" && isHooksPath(globals[index + 1] ?? "")) || /^--config-env=core\.hookspath/i.test(arg)) {
      found.push({ kind: "hooks_path", detail: `git -c ${globals[index + 1] ?? arg}` });
    }
  });
  const [sub = "", ...subArgs] = rest;
  if (VERIFY_SUBCOMMANDS.has(sub) && subArgs.includes("--no-verify"))
    found.push({ kind: "no_verify", detail: `git ${sub} --no-verify` });
  if (sub === "commit" && commitHasShortN(subArgs)) found.push({ kind: "no_verify", detail: "git commit -n" });
  if (sub === "config" && subArgs.some(isHooksPath) && !subArgs.includes("--get")) {
    found.push({ kind: "hooks_path", detail: "git config core.hooksPath" });
  }
  return found;
};

const FM_NAMES = new Set(["finitemonkey", "fm"]);

const FM_SCRIPT = /(^|[\\/])(finitemonkey|fm)(\.c?m?js)?$/;
const RUNNERS = new Set(["npx", "pnpm", "bunx", "yarn"]);

const fmStart = (argv: readonly string[]): number => {
  const first = argv[0] ?? "";
  if (RUNNERS.has(first)) return argv.findIndex((arg) => FM_NAMES.has(arg.replace(/@.*$/, "")));
  if (first === "node" || first === "bun" || first === "deno") return FM_SCRIPT.test(argv[1] ?? "") ? 1 : -1;
  return FM_SCRIPT.test(first) ? 0 : -1;
};

const fmFindings = (argv: readonly string[]): readonly BypassFinding[] => {
  const start = fmStart(argv);
  if (start < 0) return [];
  const sub = argv[start + 1];
  if (sub === "allow") return [{ kind: "fm_allow", detail: "finitemonkey allow" }];
  if (sub === "off" || sub === "on") return [{ kind: "fm_pause", detail: `finitemonkey ${sub}` }];
  return [];
};

export const detectBypass = (commandLine: string): readonly BypassFinding[] =>
  parseShell(commandLine).flatMap((command) => [
    ...envFindings(command),
    ...(command.argv[0] === "git" ? gitFindings(command.argv.slice(1)) : []),
    ...fmFindings(command.argv),
  ]);
