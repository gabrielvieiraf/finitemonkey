import type { ModApi } from "./api.js";
import type {
  Next,
  On,
  SessionStartInput,
  SessionStartResult,
  ToolCheckInput,
  ToolCheckResult,
  TurnCompleteInput,
  TurnCompleteResult,
} from "./events.js";
import { type LoadedState, parseModState } from "./state.js";
import { FAILED_REASON, ruleFor, stricter, tightenFor } from "./tighten.js";

let loaded: LoadedState | undefined;

function cliArgv($: ModApi, args: readonly string[]): readonly string[] {
  return ["node", `${$.plugin.root}/scripts/finitemonkey.mjs`, ...args];
}

async function refreshState($: ModApi): Promise<void> {
  const root = await $.session.root();
  const result = await $.process.run(cliArgv($, ["mod", "state", "--json"]), { cwd: root, timeoutMs: 20_000 });
  if (result.exitCode !== 0) return;
  const state = parseModState(result.stdout);
  if (state !== undefined) loaded = state;
}

function scheduleRefresh($: ModApi): void {
  $.clock.after(0, () => refreshState($));
}

async function recordTightening($: ModApi, rule: string, tool: string, mode: string): Promise<void> {
  const root = await $.session.root();
  await $.process.run(cliArgv($, ["mod", "record", "--rule", rule, "--tool", tool, "--mode", mode]), {
    cwd: root,
    timeoutMs: 20_000,
  });
}

function scheduleRecord($: ModApi, rule: string, tool: string, mode: string): void {
  $.clock.after(0, () => recordTightening($, rule, tool, mode));
}

async function onStart($: ModApi, e: SessionStartInput, next: Next<"session.start">): Promise<SessionStartResult> {
  scheduleRefresh($);
  return next(e);
}

async function onTurnComplete(
  $: ModApi,
  e: TurnCompleteInput,
  next: Next<"turn.complete">,
): Promise<TurnCompleteResult> {
  scheduleRefresh($);
  return next(e);
}

async function guardCheck($: ModApi, e: ToolCheckInput, next: Next<"tool.check">): Promise<ToolCheckResult> {
  const decided = await next(e);
  const state = loaded;
  if (state === undefined || state.mode === "off") return decided;
  const rule = ruleFor(state, e.tool, e.input);
  if (rule === undefined) return decided;
  scheduleRecord($, rule.rule.id, e.tool, state.mode);
  return state.mode === "active" ? stricter(decided, tightenFor(rule)) : decided;
}

async function failClosed(): Promise<ToolCheckResult> {
  return Promise.resolve({ decision: "deny", reason: loaded?.failReason ?? FAILED_REASON });
}

export function register(on: On): void {
  on("session.start", onStart);
  on("turn.complete", onTurnComplete);
  on("tool.check", guardCheck).catch(failClosed);
}
