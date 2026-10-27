import { optionalString } from "../core/parsed.js";
import { gitInvocation } from "../git/invocation.js";
import { openRepo } from "../git/repo.js";
import { takeSnapshot } from "../git/snapshot.js";
import type { HookDecision, HookHandler } from "../hooks/handlers.js";
import { toolInput, toolName } from "../secrets/guards/tool-input.js";
import { dialectOf, normalizeCommand } from "../shell/normalize.js";

const ALLOW: HookDecision = { kind: "allow" };
const SHELL = new Set(["Bash", "PowerShell"]);
const MERGING = new Set(["merge", "pull"]);

export const INTEGRATION_PREFIX = "integrate/";

export const runsMerge = (text: string, tool: string): boolean =>
  normalizeCommand(text, dialectOf(tool)).commands.some((command) => {
    const invocation = gitInvocation(command);
    return invocation !== undefined && MERGING.has(invocation.subcommand) && !invocation.args.includes("--abort");
  });

export const plainMergeAbort: HookHandler = (input) => {
  const tool = toolName(input.payload);
  if (!SHELL.has(tool)) return ALLOW;
  if (!runsMerge(optionalString(toolInput(input.payload), "command") ?? "", tool)) return ALLOW;
  const repo = openRepo(input.runtime, input.cwd);
  if (repo === undefined) return ALLOW;
  const { runtime } = input;
  const conflicted = runtime.git(["diff", "--name-only", "--diff-filter=U"], repo.root).stdout.trim();
  const merging = runtime.git(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], repo.root).ok;
  const branch = runtime.git(["symbolic-ref", "--quiet", "--short", "HEAD"], repo.root).stdout.trim();
  if (!merging || conflicted === "" || branch.startsWith(INTEGRATION_PREFIX)) return ALLOW;
  const snapshot = takeSnapshot(runtime, repo, { op: "plain merge with conflicts", command: "git merge" });
  const files = conflicted.split("\n").slice(0, 8).join(", ");
  const aborted = snapshot.ok && runtime.git(["merge", "--abort"], repo.root).ok ? snapshot.value.ref : undefined;
  const context =
    aborted === undefined
      ? input.t("merge.hook.not_aborted", { files })
      : input.t("merge.hook.aborted", { files, ref: aborted });
  return {
    kind: "allow",
    output: { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context } },
  };
};
