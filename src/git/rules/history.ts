import type { GitInvocation } from "../invocation.js";
import { hasAny, optionSpec, parseOptions, valuesOf } from "../options.js";
import { block, type GitVerdict, PASS } from "../verdict.js";

const GC = optionSpec(["--prune", "--no-prune", "--aggressive", "--auto", "--quiet", "--force", "--keep-largest-pack"]);
const UPDATE_REF = optionSpec(["--delete", "--stdin", "--no-deref", "--create-reflog", "--message"], ["--message"], "m");
const PRUNE = optionSpec(["--dry-run", "--verbose", "--progress", "--expire"], ["--expire"]);
const IMMEDIATE = new Set(["now", "all"]);

const subject = (invocation: GitInvocation): string => [invocation.subcommand, ...invocation.args].join(" ");

const reflogVerdict = (invocation: GitInvocation): GitVerdict => {
  const action = invocation.args[0] ?? "";
  return action === "expire" || action === "delete" ? block("history", subject(invocation)) : PASS;
};

const gcVerdict = (invocation: GitInvocation): GitVerdict => {
  const prune = valuesOf(parseOptions(invocation.args, GC), "--prune");
  return prune.some((value) => IMMEDIATE.has(value)) ? block("history", subject(invocation)) : PASS;
};

const updateRefVerdict = (invocation: GitInvocation): GitVerdict =>
  hasAny(parseOptions(invocation.args, UPDATE_REF), "-d", "--delete", "--stdin")
    ? block("history", subject(invocation))
    : PASS;

const pruneVerdict = (invocation: GitInvocation): GitVerdict =>
  hasAny(parseOptions(invocation.args, PRUNE), "-n", "--dry-run") ? PASS : block("history", subject(invocation));

const replaceVerdict = (invocation: GitInvocation): GitVerdict => {
  const listing = invocation.args.length === 0 || invocation.args.some((arg) => arg === "-l" || arg === "--list");
  return listing ? PASS : block("history", subject(invocation));
};

export const HISTORY_RULES: Readonly<Record<string, (invocation: GitInvocation) => GitVerdict>> = {
  reflog: reflogVerdict,
  gc: gcVerdict,
  "update-ref": updateRefVerdict,
  prune: pruneVerdict,
  replace: replaceVerdict,
  "filter-branch": (invocation) => block("history", subject(invocation)),
  "filter-repo": (invocation) => block("history", subject(invocation)),
};
