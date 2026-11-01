import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { computeIndex, thresholdsOf } from "../signals/loop-index.js";
import { readEntries, readProfile, sessionEntries, signalFiles } from "../signals/store.js";
import type { FmPaths } from "../task/paths.js";

export const BLOCK_EVENT = "guard_block";
export const GATE_HOOK = "Stop";

export interface SessionSignals {
  readonly gateHolds: number;
  readonly guardFirings: number;
  readonly loopScore: number;
}

export type SignalsOf = (session: string) => SessionSignals;

interface Blocks {
  readonly holds: Map<string, number>;
  readonly firings: Map<string, number>;
}

const bump = (counts: Map<string, number>, key: string): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

export const blocksBySession = (logText: string): Blocks => {
  const blocks: Blocks = { holds: new Map(), firings: new Map() };
  for (const line of logText.split("\n")) {
    const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
    if (parsed?.ok !== true || parsed.value["event"] !== BLOCK_EVENT) continue;
    const session = parsed.value["sessionId"];
    if (typeof session !== "string" || session === "") continue;
    bump(parsed.value["hook"] === GATE_HOOK ? blocks.holds : blocks.firings, session);
  }
  return blocks;
};

export const projectSignals = (runtime: Pick<Runtime, "readText">, paths: FmPaths): SignalsOf => {
  const log = runtime.readText(paths.log);
  const blocks = blocksBySession(log.ok ? log.value : "");
  const files = signalFiles(paths);
  const entries = readEntries(runtime, files);
  const thresholds = thresholdsOf(readProfile(runtime, files));
  return (session) => {
    const own = sessionEntries(entries, session);
    return {
      gateHolds: blocks.holds.get(session) ?? 0,
      guardFirings: blocks.firings.get(session) ?? 0,
      loopScore: own.length === 0 ? 0 : computeIndex(own, thresholds).score,
    };
  };
};
