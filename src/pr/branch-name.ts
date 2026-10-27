import type { GitInvocation } from "../git/invocation.js";

const CREATES = new Set(["-c", "-C", "-b", "-B", "--create", "--force-create", "--orphan"]);
const BRANCH_FLAGS_WITHOUT_CREATE =
  /^-(?:[dDmMcCr]|-delete|-move|-copy|-list|-remotes|-all|-show-current|-contains|-merged|-no-merged|-set-upstream-to|-unset-upstream|-edit-description|-v{1,2}|a)$/;

export const BRANCH_TYPES = ["feat", "fix", "refactor", "docs", "chore", "test", "ci", "perf", "build"] as const;

const VALID = new RegExp(
  `^(?:(?:${BRANCH_TYPES.join("|")})/[0-9]+-[a-z0-9][a-z0-9-]*|front/[A-Za-z0-9][A-Za-z0-9._-]*|agent/[A-Za-z0-9][A-Za-z0-9._/-]*|integrate/[A-Za-z0-9._/-]+|wave/[A-Za-z0-9._-]+)$`,
);

export const isConventionalBranch = (name: string): boolean => VALID.test(name);

const afterFlag = (args: readonly string[], flags: ReadonlySet<string>): string | undefined => {
  const index = args.findIndex((arg) => flags.has(arg));
  return index < 0 ? undefined : args[index + 1];
};

export const createdBranch = (invocation: GitInvocation): string | undefined => {
  const { subcommand, args } = invocation;
  if (subcommand === "switch" || subcommand === "checkout") return afterFlag(args, CREATES);
  if (subcommand === "worktree" && args[0] === "add") return afterFlag(args, new Set(["-b", "-B"]));
  if (subcommand !== "branch" || args.some((arg) => BRANCH_FLAGS_WITHOUT_CREATE.test(arg))) return undefined;
  return args.find((arg) => !arg.startsWith("-"));
};
