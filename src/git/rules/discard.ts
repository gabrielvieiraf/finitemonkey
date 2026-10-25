import type { GitFacts } from "../facts.js";
import type { GitInvocation } from "../invocation.js";
import { hasAny, optionSpec, type ParsedOptions, parseOptions, valuesOf } from "../options.js";
import { isBroadPathspec } from "../pathspec.js";
import { block, discard, type GitVerdict, PASS, snapshot } from "../verdict.js";

const RESET = optionSpec(
  ["--hard", "--soft", "--mixed", "--merge", "--keep", "--quiet", "--patch", "--intent-to-add", "--pathspec-from-file"],
  ["--pathspec-from-file"],
);

const CHECKOUT = optionSpec(
  [
    "--force",
    "--ours",
    "--theirs",
    "--merge",
    "--conflict",
    "--patch",
    "--detach",
    "--orphan",
    "--track",
    "--no-track",
    "--quiet",
    "--progress",
    "--overwrite-ignore",
    "--ignore-other-worktrees",
    "--recurse-submodules",
    "--pathspec-from-file",
  ],
  ["--conflict", "--orphan", "--pathspec-from-file"],
  "bB",
);

const RESTORE = optionSpec(
  [
    "--source",
    "--staged",
    "--worktree",
    "--patch",
    "--ours",
    "--theirs",
    "--merge",
    "--conflict",
    "--overlay",
    "--no-overlay",
    "--quiet",
    "--progress",
    "--ignore-unmerged",
    "--recurse-submodules",
    "--pathspec-from-file",
  ],
  ["--source", "--conflict", "--pathspec-from-file"],
  "s",
);

const SWITCH = optionSpec(
  [
    "--create",
    "--force-create",
    "--detach",
    "--force",
    "--discard-changes",
    "--merge",
    "--conflict",
    "--quiet",
    "--track",
    "--no-track",
    "--orphan",
    "--guess",
    "--no-guess",
  ],
  ["--create", "--force-create", "--conflict", "--orphan"],
  "cC",
);

const CLEAN = optionSpec(["--force", "--dry-run", "--quiet", "--exclude", "--interactive"], ["--exclude"], "e");

const choosesSide = (parsed: ParsedOptions, paths: readonly string[]): boolean =>
  hasAny(parsed, "--ours", "--theirs") && paths.some(isBroadPathspec);

export const resetVerdict = (invocation: GitInvocation): GitVerdict => {
  const parsed = parseOptions(invocation.args, RESET);
  if (hasAny(parsed, "--hard")) return discard("reset --hard", "tracked");
  if (hasAny(parsed, "--merge")) return discard("reset --merge", "tracked");
  if (hasAny(parsed, "--keep")) return snapshot("reset --keep");
  return PASS;
};

const checkoutPaths = (parsed: ParsedOptions, facts: GitFacts): { ref: boolean; paths: readonly string[] } => {
  if (parsed.dashdash) return { ref: parsed.positionals.length > 0, paths: parsed.paths };
  const [first, ...rest] = parsed.positionals;
  if (first === undefined) return { ref: false, paths: [] };
  if (facts.isRef(first)) return { ref: true, paths: rest };
  return { ref: false, paths: parsed.positionals };
};

export const checkoutVerdict = (invocation: GitInvocation, facts: GitFacts): GitVerdict => {
  const parsed = parseOptions(invocation.args, CHECKOUT);
  if (hasAny(parsed, "--patch", "-p")) return PASS;
  const { ref, paths } = checkoutPaths(parsed, facts);
  if (choosesSide(parsed, paths)) return block("merge-side", `checkout --ours/--theirs ${paths.join(" ")}`);
  if (hasAny(parsed, "--force", "-f")) return discard("checkout -f", "tracked");
  if (paths.length > 0) return discard("checkout -- <paths>", ref ? "all" : "worktree", paths);
  const reset = valuesOf(parsed, "-B");
  if (reset.some((name) => facts.branchExists(name))) return snapshot("checkout -B");
  return PASS;
};

export const restoreVerdict = (invocation: GitInvocation): GitVerdict => {
  const parsed = parseOptions(invocation.args, RESTORE);
  const staged = hasAny(parsed, "--staged", "-S");
  const worktree = hasAny(parsed, "--worktree", "-W") || !staged;
  if (!worktree || hasAny(parsed, "--patch", "-p")) return PASS;
  const paths = [...parsed.positionals, ...parsed.paths];
  if (choosesSide(parsed, paths)) return block("merge-side", `restore --ours/--theirs ${paths.join(" ")}`);
  const sourced = hasAny(parsed, "--source", "-s");
  return discard("restore", sourced ? "all" : staged ? "tracked" : "worktree", paths);
};

export const switchVerdict = (invocation: GitInvocation, facts: GitFacts): GitVerdict => {
  const parsed = parseOptions(invocation.args, SWITCH);
  if (hasAny(parsed, "--discard-changes", "--force", "-f")) return discard("switch --discard-changes", "tracked");
  const reset = valuesOf(parsed, "-C", "--force-create");
  if (reset.some((name) => facts.branchExists(name))) return snapshot("switch -C");
  return PASS;
};

export const cleanVerdict = (invocation: GitInvocation): GitVerdict => {
  const parsed = parseOptions(invocation.args, CLEAN);
  if (hasAny(parsed, "--dry-run", "-n") && !hasAny(parsed, "--interactive", "-i")) return PASS;
  return block("clean", ["clean", ...invocation.args].join(" "));
};

export const stashVerdict = (invocation: GitInvocation): GitVerdict => {
  const action = invocation.args[0] ?? "";
  if (action === "drop" || action === "clear") return block("stash-drop", `stash ${action}`);
  if (action === "pop" || action === "apply") return snapshot(`stash ${action}`);
  return PASS;
};
