import type { HookHandlers } from "../hooks/handlers.js";
import { fourthAttemptGuard, researchRecorder } from "./fourth.js";
import { signalsPrompt } from "./prompt.js";
import { signalsPermissionRequest, signalsPostToolUse, signalsPostToolUseFailure } from "./record.js";

export const SIGNALS_HANDLERS: HookHandlers = {
  UserPromptSubmit: [signalsPrompt],
  PostToolUse: [signalsPostToolUse, researchRecorder],
  SubagentStop: [researchRecorder],
  PostToolUseFailure: [signalsPostToolUseFailure],
  PermissionRequest: [signalsPermissionRequest],
};

export const FOURTH_ATTEMPT_HANDLERS: HookHandlers = { PreToolUse: [fourthAttemptGuard] };
