import type { GitFacts } from "../facts.js";
import type { GitInvocation } from "../invocation.js";
import { hasAny, optionSpec, parseOptions, valuesOf } from "../options.js";
import { block, type GitVerdict, PASS, snapshot } from "../verdict.js";

const BRANCH = optionSpec(
  [
    "--delete",
    "--force",
    "--move",
    "--copy",
    "--remotes",
    "--all",
    "--list",
    "--set-upstream-to",
    "--unset-upstream",
    "--track",
    "--no-track",
    "--contains",
    "--no-contains",
    "--merged",
    "--no-merged",
    "--show-current",
    "--edit-description",
    "--format",
    "--sort",
    "--points-at",
    "--column",
    "--verbose",
    "--quiet",
    "--create-reflog",
    "--ignore-case",
  ],
  ["--set-upstream-to", "--contains", "--no-contains", "--merged", "--no-merged", "--format", "--sort", "--points-at"],
  "u",
);

const REBASE = optionSpec(
  [
    "--continue",
    "--abort",
    "--skip",
    "--quit",
    "--edit-todo",
    "--show-current-patch",
    "--onto",
    "--interactive",
    "--root",
    "--autosquash",
    "--autostash",
    "--exec",
    "--strategy",
    "--strategy-option",
    "--update-refs",
    "--keep-base",
    "--merge",
    "--rebase-merges",
  ],
  ["--onto", "--exec", "--strategy", "--strategy-option"],
  "xsX",
);

const MERGE = optionSpec(
  ["--strategy", "--strategy-option", "--message", "--file", "--into-name", "--abort", "--continue", "--quit"],
  ["--strategy", "--strategy-option", "--message", "--file", "--into-name"],
  "sXmF",
);

const SIDES = new Set(["ours", "theirs"]);

export const branchVerdict = (invocation: GitInvocation, facts: GitFacts): GitVerdict => {
  const parsed = parseOptions(invocation.args, BRANCH);
  if (hasAny(parsed, "--remotes", "-r")) return PASS;
  const forced = hasAny(parsed, "--force", "-f");
  const deleting = hasAny(parsed, "-D") || (hasAny(parsed, "--delete", "-d") && forced);
  if (deleting) {
    const unmerged = parsed.positionals.find((name) => !facts.branchContained(name));
    return unmerged === undefined ? PASS : block("branch-unmerged", unmerged);
  }
  return hasAny(parsed, "-M", "-C") || (forced && parsed.positionals.length > 0) ? snapshot("branch --force") : PASS;
};

const sideOption = (values: readonly string[], strategies: readonly string[]): string | undefined =>
  values.find((value) => SIDES.has(value)) ?? strategies.find((value) => value === "ours");

export const mergeSideVerdict = (invocation: GitInvocation): GitVerdict => {
  const parsed = parseOptions(invocation.args, MERGE);
  const side = sideOption(valuesOf(parsed, "-X", "--strategy-option"), valuesOf(parsed, "-s", "--strategy"));
  return side === undefined ? PASS : block("merge-side", `${invocation.subcommand} ${side}`);
};

export const rebaseVerdict = (invocation: GitInvocation, facts: GitFacts): GitVerdict => {
  const parsed = parseOptions(invocation.args, REBASE);
  if (hasAny(parsed, "--continue", "--abort", "--skip", "--quit", "--edit-todo", "--show-current-patch")) return PASS;
  const side = sideOption(valuesOf(parsed, "-X", "--strategy-option"), []);
  if (side !== undefined) return block("merge-side", `rebase -X ${side}`);
  const named = hasAny(parsed, "--root") ? parsed.positionals[0] : parsed.positionals[1];
  const branch = named ?? facts.currentBranch();
  if (branch === undefined) return snapshot("rebase");
  if (facts.isProtected(branch)) return block("rebase-protected", branch);
  if (facts.sharedBranch(branch)) return block("rebase-shared", branch);
  return snapshot("rebase");
};
