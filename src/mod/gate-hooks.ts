import type { ModApi, ModElement, RenderInput } from "./api.js";
import { runCli } from "./cli.js";
import { readHandoff } from "./compose-hooks.js";
import type {
  CommandRunInput,
  CommandRunResult,
  FailedNext,
  Next,
  ToolCallInput,
  ToolCallResult,
  TurnCompleteInput,
  TurnCompleteResult,
} from "./events.js";
import { bandTree, GATE_PANE, paneTree } from "./gate-view.js";
import { memory } from "./memory.js";
import { bandLine, parseStatus, statusText, turnLine } from "./status.js";

export const DEBOUNCE_MS = 500;
export const GATE_COMMAND = "fm";

function bandOn(): boolean {
  return (memory.state?.band ?? "active") !== "off";
}

export async function refreshStatus($: ModApi): Promise<void> {
  const text = await runCli($, ["status", "--json"]);
  const view = text === undefined ? undefined : parseStatus(text);
  if (view === undefined) return;
  memory.view = view;
  $.ui.invalidate("ui.render");
  const surfaces = await $.session.surfaces();
  if (bandOn() && surfaces.includes("vscode")) $.ui.status(`FM ${bandLine(view)} · /fm`);
}

export function scheduleStatus($: ModApi, delay: number): void {
  memory.pending?.cancel();
  memory.pending = $.clock.after(delay, () => refreshStatus($));
}

export async function registerGateCommand($: ModApi): Promise<void> {
  try {
    await $.command.register({
      name: GATE_COMMAND,
      description: "Finite Monkey: gate state, contract and what is not verified",
      immediate: true,
    });
  } catch {
    $.ui.log("finitemonkey: /fm is taken by another command; the gate panel opens from the band");
  }
}

export async function afterTool($: ModApi, e: ToolCallInput, next: Next<"tool.call">): Promise<ToolCallResult> {
  const result = await next(e);
  scheduleStatus($, DEBOUNCE_MS);
  return result;
}

export async function passTool(_$: ModApi, e: ToolCallInput, next: FailedNext<"tool.call">): Promise<ToolCallResult> {
  return next(e);
}

async function openPane($: ModApi): Promise<void> {
  await $.ui.open({ id: GATE_PANE, title: "Finite Monkey" });
}

async function runGateNow($: ModApi): Promise<void> {
  await runCli($, ["gate"]);
  await refreshStatus($);
}

async function closePane($: ModApi): Promise<void> {
  await $.ui.close({ id: GATE_PANE });
}

export async function renderBand($: ModApi, e: RenderInput, next: Next<"ui.render">): Promise<ModElement | null> {
  const view = memory.view;
  const theirs = await next(e);
  if (view === undefined || !bandOn()) return theirs;
  const elements = $.ui.resolve(e);
  const ours = bandTree(elements, view, () => openPane($));
  return theirs === null ? ours : elements.Box({ flexDirection: "column", children: [ours, theirs] });
}

export async function renderPane($: ModApi, e: RenderInput, next: Next<"ui.render">): Promise<ModElement | null> {
  if (e.requestId !== GATE_PANE) return next(e);
  const elements = $.ui.resolve(e);
  const view = memory.view;
  if (view === undefined) return elements.Text({ key: "fm-loading", children: ["finitemonkey: reading the gate…"] });
  return paneTree(elements, view, { runGate: () => runGateNow($), close: () => closePane($) });
}

async function handoffNow($: ModApi): Promise<CommandRunResult> {
  const brief = await readHandoff($);
  if (brief === undefined) return { text: "finitemonkey: no handoff in this folder" };
  const surfaces = await $.session.surfaces();
  if (surfaces.length > 0) await $.session.compact({ instructions: brief });
  return { text: brief };
}

export async function runGateCommand($: ModApi, e: CommandRunInput): Promise<CommandRunResult> {
  if (e.args.trim() === "handoff") return handoffNow($);
  if (memory.view === undefined) await refreshStatus($);
  const surfaces = await $.session.surfaces();
  if (surfaces.length > 0) {
    await openPane($);
    return {};
  }
  const view = memory.view;
  return { text: view === undefined ? "finitemonkey: no gate status in this folder" : statusText(view) };
}

export function withTurnLine(e: TurnCompleteInput, result: TurnCompleteResult): TurnCompleteResult {
  const view = memory.view;
  if (e.agentId !== undefined || e.isAborted === true || view === undefined || view.task === null || !bandOn())
    return result;
  const line = `FM ${turnLine(view)}`;
  return { ...result, text: result.text === undefined || result.text === "" ? line : `${result.text}\n${line}` };
}
