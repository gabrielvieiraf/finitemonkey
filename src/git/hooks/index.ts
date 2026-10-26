import type { HookHandlers } from "../../hooks/handlers.js";
import { gitPreToolUse } from "./pre-tool.js";
import { gitPostToolUse, gitSessionStart } from "./session.js";

export const GIT_HANDLERS: HookHandlers = {
  SessionStart: [gitSessionStart],
  SubagentStart: [gitSessionStart],
  PreToolUse: [gitPreToolUse],
  PostToolUse: [gitPostToolUse],
};
