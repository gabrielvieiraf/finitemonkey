import type { ModApi } from "./api.js";
import { runCli } from "./cli.js";
import type { Next, ToolCheckInput, ToolCheckResult } from "./events.js";
import { memory } from "./memory.js";
import { MEMORY_HOLD_RULE, memoryHold, untrustedSeen } from "./memory-hold.js";
import { parseModState } from "./state.js";
import { type CheckResult, FAILED_REASON, modeFor, ruleFor, stricter, tightenFor } from "./tighten.js";

export async function refreshState($: ModApi): Promise<void> {
  const text = await runCli($, ["mod", "state", "--json"]);
  const state = text === undefined ? undefined : parseModState(text);
  if (state === undefined) return;
  const before = memory.state?.instructions;
  memory.state = state;
  if (before !== undefined && before !== state.instructions) $.ui.invalidate("prompt.section");
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

function withMemoryHold($: ModApi, e: ToolCheckInput, decided: ToolCheckResult): ToolCheckResult {
  const hold = memoryHold(memory.state, e.tool, e.input, memory.untrusted);
  if (hold === undefined) return decided;
  scheduleRecord($, MEMORY_HOLD_RULE, e.tool, hold.mode);
  const denied: CheckResult = { decision: "deny", reason: hold.reason };
  return hold.mode === "active" ? stricter(decided, denied) : decided;
}

export async function guardCheck($: ModApi, e: ToolCheckInput, next: Next<"tool.check">): Promise<ToolCheckResult> {
  memory.untrusted = untrustedSeen(e.tool, memory.untrusted);
  const decided = withMemoryHold($, e, await next(e));
  const state = memory.state;
  if (state === undefined || state.mode === "off") return decided;
  const rule = ruleFor(state, e.tool, e.input);
  if (rule === undefined) return decided;
  const mode = modeFor(state.mode, rule);
  if (mode === "off") return decided;
  scheduleRecord($, rule.rule.id, e.tool, mode);
  return mode === "active" ? stricter(decided, tightenFor(rule)) : decided;
}

export async function failClosed(): Promise<ToolCheckResult> {
  return Promise.resolve({ decision: "deny", reason: memory.state?.failReason ?? FAILED_REASON });
}
