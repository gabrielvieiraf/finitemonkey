import { optionalString } from "../core/parsed.js";
import { gitInvocation } from "../git/invocation.js";
import { isDryRunPush } from "../git/rules/push.js";
import type { HookDecision, HookHandler, HookInput } from "../hooks/handlers.js";
import { modelReason } from "../hooks/reason.js";
import { toolInput, toolName } from "../secrets/guards/tool-input.js";
import { dialectOf, normalizeCommand } from "../shell/normalize.js";
import type { ShellCommand } from "../shell/types.js";
import { levelRules } from "./level.js";

const ALLOW: HookDecision = { kind: "allow" };
const SHELL = new Set(["Bash", "PowerShell"]);
const REBASE_CONTROL = new Set(["--abort", "--continue", "--skip", "--quit", "--edit-todo", "--show-current-patch"]);

const isLease = (command: ShellCommand): boolean => {
  const invocation = gitInvocation(command);
  return (
    invocation?.subcommand === "push" &&
    invocation.args.some((arg) => arg.startsWith("--force-with-lease")) &&
    !isDryRunPush(invocation.args)
  );
};

const isRebaseUpdate = (command: ShellCommand): boolean => {
  const invocation = gitInvocation(command);
  if (invocation === undefined) return false;
  if (invocation.subcommand === "rebase") return !invocation.args.some((arg) => REBASE_CONTROL.has(arg));
  return invocation.subcommand === "pull" && invocation.args.some((arg) => arg === "--rebase" || arg === "-r");
};

const ask = (input: HookInput, text: string): HookDecision => ({
  kind: "allow",
  output: {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: input.t("level.ask.lease", { command: text }),
    },
  },
});

export const levelPreToolUse: HookHandler = (input) => {
  const tool = toolName(input.payload);
  if (!SHELL.has(tool)) return ALLOW;
  const text = optionalString(toolInput(input.payload), "command") ?? "";
  const commands = normalizeCommand(text, dialectOf(tool)).commands;
  const lease = commands.some(isLease);
  const rebase = commands.some(isRebaseUpdate);
  if (!lease && !rebase) return ALLOW;
  const rules = levelRules(input.runtime, input.cwd);
  if (rebase && rules.update === "merge") {
    return {
      kind: "block",
      reason: modelReason(input.t, "git.block.level_rebase", { command: text }),
      human: input.t("git.block.human"),
    };
  }
  return lease && rules.leaseOwnBranch === "ask" ? ask(input, text) : ALLOW;
};
