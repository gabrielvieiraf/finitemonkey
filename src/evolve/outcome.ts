import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { readLedgerChecked } from "../evidence/ledger.js";
import { type Evidence, GATE_CHECK } from "../evidence/types.js";
import { pastTask } from "../guardian/forecast.js";
import type { FmPaths } from "../task/paths.js";

export const DISMISSAL_EVENT = "guard_false_positive";

export interface TaskOutcome {
  readonly task: string;
  readonly falseDone: boolean;
  readonly dismissals: number;
  readonly wallMs: number;
  readonly evaluators: readonly string[];
  readonly startMs: number;
  readonly endMs: number;
}

export const dismissalTimes = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly number[] => {
  const text = runtime.readText(paths.log);
  if (!text.ok) return [];
  return text.value.split("\n").flatMap((line): number[] => {
    if (!line.includes(DISMISSAL_EVENT)) return [];
    const parsed = parseJsonObject(line);
    if (!parsed.ok || parsed.value["event"] !== DISMISSAL_EVENT) return [];
    const at = parsed.value["at"];
    const time = typeof at === "string" ? Date.parse(at) : Number.NaN;
    return Number.isFinite(time) ? [time] : [];
  });
};

const falseDoneIn = (entries: readonly Evidence[]): boolean => {
  if (entries.some((entry) => entry.state === "invalidated")) return true;
  const gates = entries.filter((entry) => entry.check === GATE_CHECK);
  const passed = gates.findIndex((entry) => entry.status === "passed");
  return passed >= 0 && gates.slice(passed + 1).some((entry) => entry.status === "failed");
};

export const taskOutcome = (
  runtime: Pick<Runtime, "readText" | "homeDir">,
  paths: FmPaths,
  task: string,
  dismissals: readonly number[],
): TaskOutcome | undefined => {
  const ledger = readLedgerChecked(runtime, paths.evidence(task));
  if (ledger.tampered > 0) return undefined;
  const past = pastTask(task, ledger.entries);
  const first = ledger.entries[0];
  const last = ledger.entries.at(-1);
  if (past === undefined || first === undefined || last === undefined) return undefined;
  const startMs = Date.parse(first.at);
  const endMs = Date.parse(last.at);
  return {
    task,
    falseDone: falseDoneIn(ledger.entries),
    dismissals: dismissals.filter((at) => at >= startMs && at <= endMs).length,
    wallMs: past.durationMs,
    evaluators: [
      ...new Set(ledger.entries.filter((entry) => entry.check === GATE_CHECK).map((entry) => entry.scripts ?? "-")),
    ],
    startMs,
    endMs,
  };
};
