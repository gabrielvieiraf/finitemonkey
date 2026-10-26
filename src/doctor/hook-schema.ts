import { isRecord } from "../core/parsed.js";
import { ON_FAILURE_MIN } from "../install/claude-version.js";

export const CLAUDE_HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "PermissionDenied",
  "Notification",
  "UserPromptSubmit",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "SessionStart",
  "SessionEnd",
  "Setup",
  "ConfigChange",
  "InstructionsLoaded",
  "TeammateIdle",
  "TaskCreated",
  "TaskCompleted",
  "WorktreeCreate",
  "WorktreeRemove",
  "Elicitation",
  "ElicitationResult",
  "CwdChanged",
  "FileChanged",
] as const;

const HANDLER_TYPES = ["command", "prompt", "agent", "http", "mcp_tool"] as const;

const atLeast = (version: readonly number[], min: readonly number[]): boolean => {
  for (const [index, part] of min.entries()) {
    const value = version[index] ?? 0;
    if (value !== part) return value > part;
  }
  return true;
};

const handlerProblems = (at: string, handler: unknown, claude: readonly number[] | undefined): readonly string[] => {
  if (!isRecord(handler)) return [`${at}: not an object`];
  const type = handler["type"];
  if (typeof type !== "string" || !HANDLER_TYPES.some((known) => known === type)) return [`${at}.type: unknown`];
  const problems: string[] = [];
  const { command, args, timeout, onFailure } = handler;
  if (type === "command" && (typeof command !== "string" || command.trim() === ""))
    problems.push(`${at}.command: empty`);
  if (args !== undefined && !(Array.isArray(args) && args.every((arg) => typeof arg === "string"))) {
    problems.push(`${at}.args: not a list of strings`);
  }
  if (timeout !== undefined && !(typeof timeout === "number" && timeout > 0))
    problems.push(`${at}.timeout: not positive`);
  if (onFailure !== undefined && onFailure !== "block") problems.push(`${at}.onFailure: unknown value`);
  if (onFailure !== undefined && claude !== undefined && !atLeast(claude, ON_FAILURE_MIN)) {
    problems.push(`${at}.onFailure: needs Claude Code ${ON_FAILURE_MIN.join(".")}`);
  }
  return problems;
};

const groupProblems = (at: string, group: unknown, claude: readonly number[] | undefined): readonly string[] => {
  if (!isRecord(group)) return [`${at}: not an object`];
  const matcher = group["matcher"];
  const hooks = group["hooks"];
  const problems = matcher === undefined || typeof matcher === "string" ? [] : [`${at}.matcher: not a string`];
  if (!Array.isArray(hooks)) return [...problems, `${at}.hooks: not a list`];
  return [
    ...problems,
    ...hooks.flatMap((handler, index) => handlerProblems(`${at}.hooks[${String(index)}]`, handler, claude)),
  ];
};

export const hookSchemaProblems = (hooks: unknown, claude: readonly number[] | undefined): readonly string[] => {
  if (hooks === undefined) return [];
  if (!isRecord(hooks)) return ["hooks: not an object"];
  return Object.entries(hooks).flatMap(([event, groups]) => {
    if (!CLAUDE_HOOK_EVENTS.some((known) => known === event)) return [`hooks.${event}: unknown event`];
    if (!Array.isArray(groups)) return [`hooks.${event}: not a list`];
    return groups.flatMap((group, index) => groupProblems(`hooks.${event}[${String(index)}]`, group, claude));
  });
};
