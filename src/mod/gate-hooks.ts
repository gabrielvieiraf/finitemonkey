import type { ModApi, ModElement, RenderInput } from "./api.js";
import { contractNow, divergeNow, isApprovalPane, renderApproval } from "./approve-hooks.js";
import { runCli } from "./cli.js";
import { readHandoff } from "./compose-hooks.js";
import { refreshCost } from "./cost-hooks.js";
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
import { boardLines, FRONTS_PANE, frontsTree } from "./fronts-view.js";
import { bandTree, COST_PANE, costTree, GATE_PANE, paneTree } from "./gate-view.js";
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
  if (e.requestId === FRONTS_PANE)
    return frontsTree($.ui.resolve(e), memory.board, () => $.ui.close({ id: FRONTS_PANE }));
  if (isApprovalPane(e.requestId)) return renderApproval($, e);
  if (e.requestId === COST_PANE) return costTree($.ui.resolve(e), memory.cost, () => $.ui.close({ id: COST_PANE }));
  if (e.requestId !== GATE_PANE) return next(e);
  const elements = $.ui.resolve(e);
  const view = memory.view;
  if (view === undefined) return elements.Text({ key: "fm-loading", children: ["finitemonkey: reading the gate…"] });
  return paneTree(elements, view, { runGate: () => runGateNow($), close: () => closePane($) });
}

async function costNow($: ModApi): Promise<CommandRunResult> {
  const lines = await refreshCost($);
  const surfaces = await $.session.surfaces();
  if (surfaces.length > 0) {
    await $.ui.open({ id: COST_PANE, title: "Finite Monkey · cost" });
    return {};
  }
  return { text: lines.length === 0 ? "finitemonkey: no cost recorded for this contract" : lines.join("\n") };
}

async function frontsNow($: ModApi): Promise<CommandRunResult> {
  const json = await runCli($, ["fronts", "board", "--json"]);
  memory.board = json === undefined ? [] : boardLines(json);
  const surfaces = await $.session.surfaces();
  if (surfaces.length > 0) {
    await $.ui.open({ id: FRONTS_PANE, title: "Finite Monkey · fronts" });
    return {};
  }
  return { text: memory.board.length === 0 ? "finitemonkey: no worktrees found" : memory.board.join("\n") };
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
  if (e.args.trim() === "cost") return costNow($);
  if (e.args.trim() === "fronts") return frontsNow($);
  if (e.args.trim() === "contract") return contractNow($);
  if (e.args.trim() === "diverge") return divergeNow($);
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
