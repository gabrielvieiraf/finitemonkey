import type { HookHandlers } from "../hooks/handlers.js";
import { signalsPrompt } from "./prompt.js";
import { signalsPermissionRequest, signalsPostToolUse, signalsPostToolUseFailure } from "./record.js";

export const SIGNALS_HANDLERS: HookHandlers = {
  UserPromptSubmit: [signalsPrompt],
  PostToolUse: [signalsPostToolUse],
  PostToolUseFailure: [signalsPostToolUseFailure],
  PermissionRequest: [signalsPermissionRequest],
};
