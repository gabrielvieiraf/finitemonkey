import type { ModApi, ModElement, RenderInput } from "./api.js";
import { contractNow } from "./approve-hooks.js";
import { runCli } from "./cli.js";
import type { CommandRunResult } from "./events.js";
import { memory } from "./memory.js";
import { parseConcepts, parseXray, XRAY_PANE, xrayLines, type XrayRow, xrayTree } from "./xray-view.js";

async function loadXray($: ModApi): Promise<void> {
  const xray = await runCli($, ["xray", "--json"]);
  const concepts = await runCli($, ["conceitos", "evidence", "--json"]);
  memory.xray = xray === undefined ? undefined : parseXray(xray);
  memory.concepts = concepts === undefined ? [] : parseConcepts(concepts);
}

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
      close: () => $.ui.close({ id: XRAY_PANE }),
    },
    e.surface,
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
