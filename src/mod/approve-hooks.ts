import type { ModApi, ModElement, RenderInput } from "./api.js";
import {
  CONTRACT_PANE,
  contractLines,
  contractTree,
  DIVERGE_PANE,
  divergeLines,
  divergeTree,
  parseContractView,
  parseDivergeView,
} from "./approve-view.js";
import { runCli } from "./cli.js";
import type { CommandRunResult } from "./events.js";
import { memory } from "./memory.js";

async function loadContract($: ModApi): Promise<void> {
  const text = await runCli($, ["task", "trust", "--json"]);
  memory.contract = text === undefined ? undefined : parseContractView(text);
}

async function loadDivergence($: ModApi): Promise<void> {
  const text = await runCli($, ["task", "diverge", "--pending", "--json"]);
  memory.divergence = text === undefined ? undefined : parseDivergeView(text);
}

function redraw($: ModApi, notice: string | undefined): void {
  memory.notice = notice;
  $.ui.invalidate("ui.render");
}

async function approveShown($: ModApi): Promise<void> {
  const shown = memory.contract;
  if (shown === undefined || shown.trusted) return;
  const done = await runCli($, ["task", "trust", shown.task, "--hash", shown.hash, "--digest", shown.digest, "--json"]);
  await loadContract($);
  redraw(
    $,
    done === undefined
      ? "Not approved: the contract changed after it was shown or could not be read. Check the text above and press again."
      : `Approved ${shown.task} with hash ${shown.hash.slice(0, 12)}.`,
  );
}

async function decideExample($: ModApi, id: string, verdict: "approve" | "reject"): Promise<void> {
  const task = memory.contract?.task;
  if (task === undefined) return;
  const done = await runCli($, ["task", "examples", task, `--${verdict}`, id, "--json"]);
  await loadContract($);
  redraw(
    $,
    done === undefined
      ? `${id} not recorded: approve the contract before its examples.`
      : `${id} ${verdict === "approve" ? "approved" : "rejected"}.`,
  );
}

function editContract($: ModApi): Promise<void> {
  const task = memory.contract?.task;
  if (task !== undefined)
    redraw($, `Edit .finitemonkey/tasks/${task}.yml or ask for the change, then run /fm contract again.`);
  return Promise.resolve();
}

async function rejectContract($: ModApi): Promise<void> {
  const task = memory.contract?.task;
  memory.notice = undefined;
  $.ui.log(`finitemonkey: contract ${task ?? "-"} left unapproved; the gate keeps its commands from running`);
  await $.ui.close({ id: CONTRACT_PANE });
}

async function answer($: ModApi, args: readonly string[], said: string): Promise<void> {
  const task = memory.divergence?.task;
  if (task === undefined) return;
  const done = await runCli($, ["task", "diverge", task, ...args, "--json"]);
  await loadDivergence($);
  redraw($, done === undefined ? "Not recorded: approve the contract first, then answer again." : said);
}

async function chooseOption($: ModApi, letter: string): Promise<void> {
  await answer($, ["--choose", letter], `Stored: ${letter} is now an approved example.`);
}

async function wantOwn($: ModApi, value: string): Promise<void> {
  if (value.trim() === "") return;
  await answer($, ["--want", value], "Stored: your answer is now an approved example.");
}

export function renderApproval($: ModApi, e: RenderInput): ModElement | null {
  const elements = $.ui.resolve(e);
  if (e.requestId === DIVERGE_PANE)
    return divergeTree(elements, memory.divergence, memory.notice, {
      choose: (letter) => chooseOption($, letter),
      want: (value) => wantOwn($, value),
      close: () => $.ui.close({ id: DIVERGE_PANE }),
    });
  const view = memory.contract;
  if (view === undefined) return elements.Text({ key: "fm-contract-none", children: ["no contract to approve"] });
  return contractTree(elements, view, memory.notice, {
    approve: () => approveShown($),
    decide: (id, verdict) => decideExample($, id, verdict),
    edit: () => editContract($),
    reject: () => rejectContract($),
  });
}

export const isApprovalPane = (id: string): boolean => id === CONTRACT_PANE || id === DIVERGE_PANE;

export async function contractNow($: ModApi): Promise<CommandRunResult> {
  await loadContract($);
  memory.notice = undefined;
  const surfaces = await $.session.surfaces();
  const view = memory.contract;
  if (surfaces.length > 0) {
    await $.ui.open({ id: CONTRACT_PANE, title: "Finite Monkey · contract" });
    return {};
  }
  if (view === undefined) return { text: "finitemonkey: no active contract" };
  return {
    text: [
      ...contractLines(view),
      ...(view.trusted ? [] : [`approve it in the terminal: fm: trust ${view.task}`]),
    ].join("\n"),
  };
}

export async function divergeNow($: ModApi): Promise<CommandRunResult> {
  await loadDivergence($);
  memory.notice = undefined;
  const surfaces = await $.session.surfaces();
  const view = memory.divergence;
  if (surfaces.length > 0) {
    await $.ui.open({ id: DIVERGE_PANE, title: "Finite Monkey · which one do you want?" });
    return {};
  }
  if (view === undefined) return { text: "finitemonkey: no open divergence question" };
  return {
    text: [
      ...divergeLines(view),
      `answer in the terminal: finitemonkey task diverge ${view.task} --choose <letter>`,
    ].join("\n"),
  };
}
