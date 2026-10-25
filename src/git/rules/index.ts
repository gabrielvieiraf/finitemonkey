import type { GitFacts } from "../facts.js";
import type { GitInvocation } from "../invocation.js";
import { type GitVerdict, PASS, worst } from "../verdict.js";
import { branchVerdict, mergeSideVerdict, rebaseVerdict } from "./branch.js";
import { checkoutVerdict, cleanVerdict, resetVerdict, restoreVerdict, stashVerdict, switchVerdict } from "./discard.js";
import { HISTORY_RULES } from "./history.js";
import { protectedVerdict } from "./protected.js";
import { pushVerdict } from "./push.js";
import { worktreeVerdict } from "./worktree.js";

type Rule = (invocation: GitInvocation, facts: GitFacts) => GitVerdict;

const RULES: Readonly<Record<string, Rule>> = {
  push: pushVerdict,
  reset: resetVerdict,
  checkout: checkoutVerdict,
  restore: restoreVerdict,
  switch: switchVerdict,
  clean: cleanVerdict,
  stash: stashVerdict,
  branch: branchVerdict,
  worktree: worktreeVerdict,
  rebase: rebaseVerdict,
  merge: mergeSideVerdict,
  pull: mergeSideVerdict,
  "cherry-pick": mergeSideVerdict,
  revert: mergeSideVerdict,
  ...HISTORY_RULES,
};

export const BUILTIN_SUBCOMMANDS = new Set([
  ...Object.keys(RULES),
  "add",
  "am",
  "bisect",
  "blame",
  "cat-file",
  "commit",
  "config",
  "describe",
  "diff",
  "fetch",
  "grep",
  "init",
  "log",
  "ls-files",
  "ls-remote",
  "merge-base",
  "mv",
  "remote",
  "rev-list",
  "rev-parse",
  "rm",
  "show",
  "status",
  "tag",
]);

export const gitVerdict = (invocation: GitInvocation, facts: GitFacts): GitVerdict => {
  const rule = RULES[invocation.subcommand];
  const destructive = rule === undefined ? PASS : rule(invocation, facts);
  if (destructive.kind === "block") return destructive;
  return worst([destructive, protectedVerdict(invocation, facts)]);
};
