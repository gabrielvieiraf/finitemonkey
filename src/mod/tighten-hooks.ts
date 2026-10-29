import type { ModApi } from "./api.js";
import { runCli } from "./cli.js";
import type { Next, ToolCheckInput, ToolCheckResult } from "./events.js";
import { memory } from "./memory.js";
import { parseModState } from "./state.js";
import { FAILED_REASON, ruleFor, stricter, tightenFor } from "./tighten.js";

export async function refreshState($: ModApi): Promise<void> {
  const text = await runCli($, ["mod", "state", "--json"]);
  const state = text === undefined ? undefined : parseModState(text);
  if (state !== undefined) memory.state = state;
}

export function scheduleRefresh($: ModApi): void {
  $.clock.after(0, () => refreshState($));
}

async function recordTightening($: ModApi, rule: string, tool: string, mode: string): Promise<void> {
  await runCli($, ["mod", "record", "--rule", rule, "--tool", tool, "--mode", mode]);
}

function scheduleRecord($: ModApi, rule: string, tool: string, mode: string): void {
  $.clock.after(0, () => recordTightening($, rule, tool, mode));
}

export async function guardCheck($: ModApi, e: ToolCheckInput, next: Next<"tool.check">): Promise<ToolCheckResult> {
  const decided = await next(e);
  const state = memory.state;
  if (state === undefined || state.mode === "off") return decided;
  const rule = ruleFor(state, e.tool, e.input);
  if (rule === undefined) return decided;
  scheduleRecord($, rule.rule.id, e.tool, state.mode);
  return state.mode === "active" ? stricter(decided, tightenFor(rule)) : decided;
}

export async function failClosed(): Promise<ToolCheckResult> {
  return Promise.resolve({ decision: "deny", reason: memory.state?.failReason ?? FAILED_REASON });
}
