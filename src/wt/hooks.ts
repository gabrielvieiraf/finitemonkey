import { optionalString } from "../core/parsed.js";
import { gitInvocation } from "../git/invocation.js";
import type { HookDecision, HookHandler, HookInput } from "../hooks/handlers.js";
import type { HookPayload } from "../hooks/payload.js";
import { toolInput, toolName } from "../secrets/guards/tool-input.js";
import { dialectOf, normalizeCommand } from "../shell/normalize.js";
import { adoptWorktrees } from "./adopt.js";
import type { WorktreeOwner } from "./entry.js";

const ALLOW: HookDecision = { kind: "allow" };

const SHELL = new Set(["Bash", "PowerShell"]);

export const hookOwner = (payload: HookPayload): WorktreeOwner => {
  const agentId = optionalString(payload.raw, "agent_id") ?? null;
  return { kind: agentId === null ? "session" : "subagent", agentId, sessionId: payload.sessionId ?? null };
};

export const addsWorktree = (text: string, tool: string): boolean =>
  normalizeCommand(text, dialectOf(tool)).commands.some((command) => {
    const invocation = gitInvocation(command);
    return invocation?.subcommand === "worktree" && invocation.args[0] === "add";
  });

const adopt = (input: HookInput): HookDecision => {
  adoptWorktrees(input.runtime, input.cwd, hookOwner(input.payload));
  return ALLOW;
};

export const wtSessionStart: HookHandler = (input) => adopt(input);

export const wtPostToolUse: HookHandler = (input) => {
  const tool = toolName(input.payload);
  if (tool === "EnterWorktree") return adopt(input);
  if (!SHELL.has(tool)) return ALLOW;
  const command = optionalString(toolInput(input.payload), "command") ?? "";
  return addsWorktree(command, tool) ? adopt(input) : ALLOW;
};
