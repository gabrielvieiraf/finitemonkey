import type { GitInvocation } from "../invocation.js";
import { hasAny, optionSpec, parseOptions } from "../options.js";
import { block, type GitVerdict, PASS } from "../verdict.js";

const WORKTREE = optionSpec(["--force", "--detach", "--checkout", "--lock", "--reason", "--quiet"], ["--reason"], "b");

export const worktreeVerdict = (invocation: GitInvocation): GitVerdict => {
  const [action, ...rest] = invocation.args;
  if (action !== "remove") return PASS;
  const parsed = parseOptions(rest, WORKTREE);
  return hasAny(parsed, "--force", "-f") ? block("worktree-force", parsed.positionals.join(" ")) : PASS;
};
