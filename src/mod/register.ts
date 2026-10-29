import type { ModApi } from "./api.js";
import { attributionText } from "./attribution-hooks.js";
import type {
  Next,
  On,
  SessionStartInput,
  SessionStartResult,
  TurnCompleteInput,
  TurnCompleteResult,
} from "./events.js";
import {
  afterTool,
  GATE_COMMAND,
  passTool,
  registerGateCommand,
  renderBand,
  renderPane,
  runGateCommand,
  scheduleStatus,
  withTurnLine,
} from "./gate-hooks.js";
import { failClosed, guardCheck, scheduleRefresh } from "./tighten-hooks.js";

const WATCHED_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "PowerShell"];

async function onStart($: ModApi, e: SessionStartInput, next: Next<"session.start">): Promise<SessionStartResult> {
  scheduleRefresh($);
  scheduleStatus($, 0);
  await registerGateCommand($);
  return next(e);
}

async function onTurnComplete(
  $: ModApi,
  e: TurnCompleteInput,
  next: Next<"turn.complete">,
): Promise<TurnCompleteResult> {
  scheduleRefresh($);
  scheduleStatus($, 0);
  return withTurnLine(e, await next(e));
}

export function register(on: On): void {
  on("session.start", onStart);
  on("turn.complete", onTurnComplete);
  on("tool.check", guardCheck).catch(failClosed);
  on("tool.call", { tool: WATCHED_TOOLS }, afterTool).catch(passTool);
  on("ui.render", { component: "AbovePrompt" }, renderBand);
  on("ui.render", { component: "Pane" }, renderPane);
  on("command.run", { command: GATE_COMMAND }, runGateCommand);
  on("attribution.text", attributionText);
}
