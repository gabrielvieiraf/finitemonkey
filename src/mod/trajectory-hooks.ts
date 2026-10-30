import type { DomainTrajectory, Mark } from "../conceitos/trajectory.js";
import { themeOf } from "../conceitos/trajectory-palette.js";
import type { ModApi, ModElement, RenderInput } from "./api.js";
import { runCli } from "./cli.js";
import type { CommandRunResult } from "./events.js";
import { memory } from "./memory.js";
import { parseTrajectories, TRAJECTORY_PANE, trajectoryText, trajectoryTree } from "./trajectory-view.js";

const DEFAULT_COLUMNS = 72;

function selectMark($: ModApi, mark: Mark): Promise<void> {
  memory.selectedMark = mark;
  $.ui.invalidate("ui.render");
  return Promise.resolve();
}

async function readTheme($: ModApi): Promise<void> {
  try {
    const rows = await $.config.list();
    memory.theme = themeOf(rows.find((row) => row.key === "theme")?.value);
  } catch {
    memory.theme = "auto";
  }
}

export function renderTrajectory($: ModApi, e: RenderInput): ModElement {
  const columns = (e.props?.bodyColumns ?? DEFAULT_COLUMNS) - 2;
  return trajectoryTree(
    $.ui.resolve(e),
    memory.trajectory,
    memory.selectedMark,
    { surface: e.surface, columns, theme: memory.theme },
    {
      select: (mark) => selectMark($, mark),
      close: () => $.ui.close({ id: TRAJECTORY_PANE }),
    },
  );
}

export async function trajectoryNow($: ModApi): Promise<CommandRunResult> {
  const text = await runCli($, ["trajectory", "--json"]);
  const domains: readonly DomainTrajectory[] = text === undefined ? [] : parseTrajectories(text);
  memory.trajectory = domains;
  memory.selectedMark = undefined;
  const surfaces = await $.session.surfaces();
  if (surfaces.length > 0) {
    await readTheme($);
    await $.ui.open({ id: TRAJECTORY_PANE, title: "Finite Monkey · trajectory" });
    return {};
  }
  return { text: domains.length === 0 ? "finitemonkey: no trajectory in this folder" : trajectoryText(domains) };
}
