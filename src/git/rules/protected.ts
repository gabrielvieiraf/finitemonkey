import type { GitFacts } from "../facts.js";
import type { GitInvocation } from "../invocation.js";
import { hasAny, parseOptions } from "../options.js";
import { block, type GitVerdict, PASS } from "../verdict.js";
import { PUSH_OPTIONS, pushDestinations } from "./push.js";

const COMMITS_ON_CURRENT = new Set(["commit", "merge", "cherry-pick", "revert", "am", "rebase"]);
const LEAVES = new Set(["--abort", "--quit", "--skip", "--dry-run", "--show-current-patch"]);

const commitVerdict = (invocation: GitInvocation, facts: GitFacts): GitVerdict => {
  if (invocation.args.some((arg) => LEAVES.has(arg))) return PASS;
  if (invocation.subcommand === "rebase") return PASS;
  const current = facts.currentBranch();
  return current !== undefined && facts.isProtected(current) ? block("protected-commit", current) : PASS;
};

const pushVerdict = (invocation: GitInvocation, facts: GitFacts): GitVerdict => {
  const parsed = parseOptions(invocation.args, PUSH_OPTIONS);
  if (hasAny(parsed, "--dry-run", "-n")) return PASS;
  const destinations = pushDestinations(parsed, facts);
  if (destinations === "all") return block("protected-push", facts.defaultBranch());
  const hit = destinations.find((name) => facts.isProtected(name));
  return hit === undefined ? PASS : block("protected-push", hit);
};

export const protectedVerdict = (invocation: GitInvocation, facts: GitFacts): GitVerdict => {
  if (invocation.subcommand === "push") return pushVerdict(invocation, facts);
  if (COMMITS_ON_CURRENT.has(invocation.subcommand)) return commitVerdict(invocation, facts);
  return PASS;
};
