import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { nowMs } from "../core/clock.js";
import type { JsonObject } from "../core/parsed.js";
import type { HookDecision, HookInput } from "../hooks/handlers.js";
import { capReason } from "../hooks/reason.js";
import { fmPaths } from "../task/paths.js";
import { activeGrant, type Grant } from "./release/grants.js";

export const guardRoot = (input: HookInput): AbsolutePath => {
  const project = input.env["CLAUDE_PROJECT_DIR"];
  if (project !== undefined && project !== "") return toAbsolutePath(project);
  return input.payload.cwd === undefined ? input.cwd : toAbsolutePath(input.payload.cwd, input.cwd);
};

export const grantFor = (input: HookInput, guard: string): Grant | undefined => {
  const { runtime } = input;
  return activeGrant(runtime, fmPaths(guardRoot(input)), guard, nowMs(runtime), input.payload.sessionId);
};

export const deny = (fullReason: string, humanText: string): HookDecision => {
  const reason = capReason(fullReason);
  const output: JsonObject = {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    systemMessage: `finitemonkey: ${humanText}`,
  };
  return { kind: "block", reason, output };
};

export const FILE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
export const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
