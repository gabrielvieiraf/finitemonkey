import type { HookHandlers } from "../../hooks/handlers.js";
import { plainMergeAbort } from "../../merge/abort-hook.js";
import { prPreToolUse } from "../../pr/hooks.js";
import { wtPostToolUse, wtSessionStart } from "../../wt/hooks.js";
import { gitPreToolUse } from "./pre-tool.js";
import { gitPostToolUse, gitSessionStart } from "./session.js";

export const GIT_HANDLERS: HookHandlers = {
  SessionStart: [gitSessionStart, wtSessionStart],
  SubagentStart: [gitSessionStart],
  PreToolUse: [gitPreToolUse, prPreToolUse],
  PostToolUse: [gitPostToolUse, wtPostToolUse, plainMergeAbort],
};
