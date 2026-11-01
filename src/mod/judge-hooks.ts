import { JUDGE_PANE_REQUEST, judgeProcess } from "../judge/call.js";
import type { ModApi, ModElement, RenderInput } from "./api.js";
import { CLI_TIMEOUT_MS, cliArgv } from "./cli.js";
import type { CommandRunResult } from "./events.js";
import { JUDGE_PANE, judgeLines, judgeTree } from "./judge-view.js";
import { memory } from "./memory.js";

export async function judgeCall($: ModApi, request: Readonly<Record<string, unknown>>): Promise<string | undefined> {
  const root = await $.session.root();
  const call = judgeProcess(request);
  const result = await $.process.run(cliArgv($, call.args), {
    cwd: root,
    timeoutMs: CLI_TIMEOUT_MS,
    stdin: call.stdin,
  });
  return result.exitCode === 0 ? result.stdout : undefined;
}

export function renderJudge($: ModApi, e: RenderInput): ModElement {
  return judgeTree($.ui.resolve(e), memory.judge, () => $.ui.close({ id: JUDGE_PANE }));
}

export async function judgeNow($: ModApi): Promise<CommandRunResult> {
  const json = await judgeCall($, JUDGE_PANE_REQUEST);
  memory.judge = json === undefined ? [] : judgeLines(json);
  const surfaces = await $.session.surfaces();
  if (surfaces.length > 0) {
    await $.ui.open({ id: JUDGE_PANE, title: "Finite Monkey · judge" });
    return {};
  }
  return { text: memory.judge.length === 0 ? "finitemonkey: no research ricochet recorded" : memory.judge.join("\n") };
}
