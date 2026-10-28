import { promptLog } from "../../audit/log.js";
import { bypassGuard } from "../../guards/bypass/hook.js";
import { reviewAgentGuard } from "../../guards/review/hook.js";
import { compareRan, recordChecked, rewriteStop } from "../../guards/rewrite/hooks.js";
import { selfGuard } from "../../guards/self/hook.js";
import { testsGuard } from "../../guards/tests/hook.js";
import type { HookHandlers } from "../../hooks/handlers.js";
import { lookReadTracker } from "../../look/reads.js";
import { pausePrompt, unlessPaused } from "../../policy/pause-hooks.js";
import { budgetPrompt } from "../../spend/hook.js";
import { configChange } from "./config.js";
import { promptRelease } from "./prompt.js";
import { preCompact, sessionStart } from "./session.js";
import { stopGate, subagentStopGate } from "./stop.js";
import { subagentStart } from "./subagent.js";

export const PORTAO_HANDLERS: HookHandlers = {
  PreToolUse: [reviewAgentGuard, selfGuard, bypassGuard, testsGuard, recordChecked],
  PostToolUse: [compareRan, lookReadTracker],
  UserPromptSubmit: [promptLog, pausePrompt, promptRelease, budgetPrompt],
  Stop: [rewriteStop, unlessPaused(stopGate)],
  SubagentStop: [unlessPaused(subagentStopGate)],
  SubagentStart: [subagentStart],
  PreCompact: [preCompact],
  SessionStart: [sessionStart],
  ConfigChange: [configChange],
};
