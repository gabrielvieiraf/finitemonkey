import type { HookEvent } from "./events.js";
import { textField, toolInput, toolName } from "./fields.js";
import type { HookPayload } from "./payload.js";

const READ_TOOLS = new Set(["Read", "Grep", "Glob", "LS"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const CHAINING = /[;&|`$()<>\n\r]/;
const REPAIR_COMMAND =
  /^\s*(?:(?:npx\s+(?:-y\s+)?)?finitemonkey|fm|node\s+(?:"[^"]*finitemonkey\.mjs"|'[^']*finitemonkey\.mjs'|\S*finitemonkey\.mjs))\s+(?:doctor|off|on|status|help|--version)(?:\s+--?[\w-]+)*\s*$/;

const repairCommand = (command: string): boolean => !CHAINING.test(command) && REPAIR_COMMAND.test(command);

export const repairsItself = (event: HookEvent, payload: HookPayload | undefined): boolean => {
  if (event !== "PreToolUse" || payload === undefined) return false;
  const tool = toolName(payload.raw);
  if (READ_TOOLS.has(tool)) return true;
  return SHELL_TOOLS.has(tool) && repairCommand(textField(toolInput(payload.raw), "command") ?? "");
};
