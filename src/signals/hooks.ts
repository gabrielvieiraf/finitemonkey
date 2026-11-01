import { bashSnapshot, bashWriteRecorder } from "../bashwrites/record.js";
import type { HookHandlers } from "../hooks/handlers.js";
import { fourthAttemptGuard, researchRecorder } from "./fourth.js";
import { signalsPrompt } from "./prompt.js";
import { signalsPermissionRequest, signalsPostToolUse, signalsPostToolUseFailure } from "./record.js";

export const SIGNALS_HANDLERS: HookHandlers = {
  UserPromptSubmit: [signalsPrompt],
  PreToolUse: [bashSnapshot],
  PostToolUse: [signalsPostToolUse, bashWriteRecorder, researchRecorder],
  SubagentStop: [researchRecorder],
  PostToolUseFailure: [signalsPostToolUseFailure, bashWriteRecorder],
  PermissionRequest: [signalsPermissionRequest],
};

export const FOURTH_ATTEMPT_HANDLERS: HookHandlers = { PreToolUse: [fourthAttemptGuard] };
