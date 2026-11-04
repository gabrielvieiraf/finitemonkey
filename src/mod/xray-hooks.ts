import type { ModApi, ModElement, RenderInput } from "./api.js";
import { contractNow } from "./approve-hooks.js";
import { runCli } from "./cli.js";
import type { CommandRunResult } from "./events.js";
import { memory } from "./memory.js";
import { parseProbeCard, parseTeachCard, parseTeachReason, REASON_TEXT } from "./teach-view.js";
import { parseConcepts, parseXray, XRAY_PANE, xrayLines, type XrayRow, xrayTree } from "./xray-view.js";

const TEACH_OFF = "teach-back is off; it runs after guards: teach-back: active in .fm/policy.yml";

async function loadXray($: ModApi): Promise<void> {
  const xray = await runCli($, ["xray", "--json"]);
  const concepts = await runCli($, ["conceitos", "evidence", "--json"]);
  memory.xray = xray === undefined ? undefined : parseXray(xray);
  memory.concepts = concepts === undefined ? [] : parseConcepts(concepts);
  const teach = await runCli($, ["teach", "--json"]);
  const probes = await runCli($, ["probe", "--json"]);
  memory.teachCard = teach === undefined ? undefined : parseTeachCard(teach);
  memory.probeCard = probes === undefined ? undefined : parseProbeCard(probes);
}

function noticeOf(out: string | undefined, done: string | undefined): string | undefined {
  if (out === undefined) return TEACH_OFF;
  const reason = parseTeachReason(out);
  return reason === undefined ? done : (REASON_TEXT[reason] ?? reason);
}

async function teachAct($: ModApi, args: readonly string[], done?: string): Promise<void> {
  const out = await runCli($, [...args, "--json"]);
  memory.teachNotice = args[0] === "probe" ? undefined : noticeOf(out, done);
  await loadXray($);
  $.ui.invalidate("ui.render");
}

const conceptsArg = (row: XrayRow): readonly string[] => ["--concepts", row.concepts.join(",")];

async function decideRow($: ModApi, row: XrayRow, flag: "--leave" | "--skip"): Promise<void> {
  await runCli($, ["xray", "decide", `${row.file}:${String(row.start)}`, flag, "--json"]);
  memory.xray =
    memory.xray === undefined
      ? undefined
      : {
          ...memory.xray,
          items: memory.xray.items.filter((item) => item.file !== row.file || item.start !== row.start),
        };
  $.ui.invalidate("ui.render");
}

async function createCriterion($: ModApi): Promise<void> {
  await contractNow($);
}

export function renderXray($: ModApi, e: RenderInput): ModElement {
  return xrayTree(
    $.ui.resolve(e),
    memory.xray,
    memory.concepts,
    {
      criterion: () => createCriterion($),
      leave: (row) => decideRow($, row, "--leave"),
      skip: (row) => decideRow($, row, "--skip"),
      predict: (row) => teachAct($, ["teach", "ask", ...conceptsArg(row)]),
      know: (row) => teachAct($, ["teach", "know", ...conceptsArg(row)]),
      explain: (row, text) =>
        teachAct(
          $,
          ["teach", "explain", ...conceptsArg(row), text],
          "Explanation stored as written; it is never graded.",
        ),
      answerProbe: (probe, option) => teachAct($, ["probe", "answer", probe, option]),
      skipProbe: (probe) => teachAct($, ["probe", "skip", probe]),
      skipQuestion: (question) => teachAct($, ["teach", "skip", question]),
      close: () => $.ui.close({ id: XRAY_PANE }),
    },
    e.surface,
    { teach: memory.teachCard, probe: memory.probeCard, notice: memory.teachNotice },
  );
}

export async function xrayNow($: ModApi): Promise<CommandRunResult> {
  await loadXray($);
  const surfaces = await $.session.surfaces();
  if (surfaces.length > 0) {
    await $.ui.open({ id: XRAY_PANE, title: "Finite Monkey · x-ray" });
    return {};
  }
  const view = memory.xray;
  return {
    text: view === undefined ? "finitemonkey: no x-ray in this folder" : xrayLines(view, memory.concepts).join("\n"),
  };
}
