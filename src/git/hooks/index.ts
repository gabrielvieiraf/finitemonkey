import { frontsPostToolUse, frontsPreToolUse, frontsSubagentStart } from "../../fronts/hooks.js";
import { frontNotification, frontReportHandback, frontReportStop } from "../../fronts/report-hooks.js";
import { fileLockGuard, fileLockRelease } from "../../guards/files/hook.js";
import { scopeCopyGuard } from "../../guards/scope/copy.js";
import type { HookHandlers } from "../../hooks/handlers.js";
import { plainMergeAbort } from "../../merge/abort-hook.js";
import { prPreToolUse } from "../../pr/hooks.js";
import { levelPreToolUse } from "../../profile/git-hook.js";
import { wtPostToolUse, wtSessionStart } from "../../wt/hooks.js";
import { gitPreToolUse } from "./pre-tool.js";
import { gitPostToolUse, gitSessionStart } from "./session.js";

export const GIT_HANDLERS: HookHandlers = {
  SessionStart: [gitSessionStart, wtSessionStart],
  SubagentStart: [gitSessionStart, frontsSubagentStart],
  PreToolUse: [
    gitPreToolUse,
    prPreToolUse,
    levelPreToolUse,
    fileLockGuard,
    scopeCopyGuard,
    frontsPreToolUse,
    frontReportHandback,
  ],
  SubagentStop: [frontReportStop, fileLockRelease],
  UserPromptSubmit: [frontNotification],
  SessionEnd: [fileLockRelease],
  PostToolUse: [gitPostToolUse, wtPostToolUse, plainMergeAbort, frontsPostToolUse],
};
