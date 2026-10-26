import { bypassGuard } from "../../guards/bypass/hook.js";
import { selfGuard } from "../../guards/self/hook.js";
import { testsGuard } from "../../guards/tests/hook.js";
import type { HookHandlers } from "../../hooks/handlers.js";
import { pausePrompt, unlessPaused } from "../../policy/pause-hooks.js";
import { lookReadTracker } from "../../look/reads.js";
import { configChange } from "./config.js";
import { promptRelease } from "./prompt.js";
import { preCompact, sessionStart } from "./session.js";
import { stopGate, subagentStopGate } from "./stop.js";
import { subagentStart } from "./subagent.js";

export const PORTAO_HANDLERS: HookHandlers = {
  PreToolUse: [selfGuard, bypassGuard, testsGuard],
  UserPromptSubmit: [pausePrompt, promptRelease],
  Stop: [unlessPaused(stopGate)],
  SubagentStop: [unlessPaused(subagentStopGate)],
  SubagentStart: [subagentStart],
  PreCompact: [preCompact],
  SessionStart: [sessionStart],
  ConfigChange: [configChange],
  PostToolUse: [lookReadTracker],
};
