import type { Env } from "../core/context.js";
import { optionalString } from "../core/parsed.js";
import { defaultOn } from "../defaults/items.js";
import { gitInvocation } from "../git/invocation.js";
import type { HookDecision, HookHandler, HookInput } from "../hooks/handlers.js";
import { modelReason } from "../hooks/reason.js";
import { levelRules } from "../profile/level.js";
import { toolInput, toolName } from "../secrets/guards/tool-input.js";
import { dialectOf, normalizeCommand } from "../shell/normalize.js";
import type { ShellCommand } from "../shell/types.js";
import { createdBranch, isConventionalBranch } from "./branch-name.js";

const ALLOW: HookDecision = { kind: "allow" };
const SHELL = new Set(["Bash", "PowerShell"]);
const MCP_CREATE_PR = /^mcp__.*github.*__create_pull_request$/i;
const FM = new Set(["finitemonkey", "fm"]);

export const isHeadless = (input: Pick<HookInput, "payload"> & { readonly env: Env }): boolean => {
  const mode = optionalString(input.payload.raw, "permission_mode");
  return (
    mode === "bypassPermissions" ||
    mode === "dontAsk" ||
    (input.env["CI"] ?? "") !== "" ||
    input.env["CLAUDE_CODE_ENTRYPOINT"] === "sdk-cli"
  );
};

const ghPr = (command: ShellCommand): string | undefined =>
  command.program === "gh" && command.args[0] === "pr" ? command.args[1] : undefined;

const isPrOpenAccepting = (command: ShellCommand): boolean =>
  (FM.has(command.program) || command.args.some((arg) => arg.endsWith("finitemonkey.mjs"))) &&
  command.args.includes("pr") &&
  command.args.includes("open") &&
  command.args.some((arg) => arg === "--accept-outside" || arg.startsWith("--accept-outside="));

type PrBlock =
  | "git.block.pr_create"
  | "git.block.pr_merge"
  | "git.block.pr_merge_beginner"
  | "git.block.branch_name"
  | "git.block.pr_headless";

const block = (input: HookInput, key: PrBlock, subject: string): HookDecision => ({
  kind: "block",
  reason: modelReason(input.t, key, { subject }),
  human: input.t("git.block.human"),
});

const ask = (input: HookInput, subject: string): HookDecision => ({
  kind: "allow",
  output: {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: input.t("pr.ask.outside", { subject }),
    },
  },
});

const mergeDecision = (input: HookInput, command: ShellCommand, text: string): HookDecision | undefined => {
  const rule = levelRules(input.runtime, input.cwd).mergeDefault;
  if (rule === "never") return block(input, "git.block.pr_merge_beginner", text);
  if (rule === "pr-auto" && !command.args.includes("--auto")) return block(input, "git.block.pr_merge", text);
  return undefined;
};

const branchDecision = (input: HookInput, name: string): HookDecision => {
  if (isConventionalBranch(name)) return ALLOW;
  if (defaultOn(input.runtime, input.cwd, "branch-names")) return block(input, "git.block.branch_name", name);
  const context = input.t("pr.warn.branch", { name });
  return { kind: "allow", output: { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: context } } };
};

const commandDecision = (input: HookInput, command: ShellCommand, text: string): HookDecision | undefined => {
  const sub = ghPr(command);
  if (sub === "create") return block(input, "git.block.pr_create", text);
  if (sub === "merge") return mergeDecision(input, command, text);
  if (isPrOpenAccepting(command))
    return isHeadless(input) ? block(input, "git.block.pr_headless", text) : ask(input, text);
  const invocation = gitInvocation(command);
  const name = invocation === undefined ? undefined : createdBranch(invocation);
  return name === undefined ? undefined : branchDecision(input, name);
};

export const prPreToolUse: HookHandler = (input) => {
  const tool = toolName(input.payload);
  if (MCP_CREATE_PR.test(tool)) return block(input, "git.block.pr_create", tool);
  if (!SHELL.has(tool)) return ALLOW;
  const text = optionalString(toolInput(input.payload), "command") ?? "";
  for (const command of normalizeCommand(text, dialectOf(tool)).commands) {
    const decision = commandDecision(input, command, text);
    if (decision !== undefined) return decision;
  }
  return ALLOW;
};
