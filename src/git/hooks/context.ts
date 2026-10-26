import { optionalString } from "../../core/parsed.js";
import type { HookPayload } from "../../hooks/payload.js";
import { toolInput, toolName } from "../../secrets/guards/tool-input.js";
import { ownerKey } from "../ownership.js";

export const SHELL_TOOLS: ReadonlySet<string> = new Set(["Bash", "PowerShell"]);

export const ownerOf = (payload: HookPayload): string =>
  ownerKey(optionalString(payload.raw, "agent_id") ?? payload.sessionId);

export const shellText = (payload: HookPayload): string | undefined => {
  if (!SHELL_TOOLS.has(toolName(payload))) return undefined;
  const command = optionalString(toolInput(payload), "command") ?? "";
  return command.trim() === "" ? undefined : command;
};
