import type { Runtime } from "../core/runtime.js";
import { readLedger } from "../evidence/ledger.js";
import { type Evidence, GATE_CHECK } from "../evidence/types.js";
import type { KnownTask } from "../guardian/tasks.js";
import type { FmPaths } from "../task/paths.js";

export interface TaskSpan {
  readonly start: number;
  readonly end: number;
  readonly finished: boolean;
  readonly activity: readonly number[];
}

export interface WeekLoad {
  readonly week: string;
  readonly open: number;
  readonly finished: number;
  readonly stalled: number;
}

export interface LimitProposal {
  readonly limit: number;
  readonly weeks: readonly WeekLoad[];
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const MONDAY_SHIFT = 3 * DAY_MS;
export const MIN_FLOWING_WEEKS = 2;

export const weekStart = (ms: number): number => Math.floor((ms + MONDAY_SHIFT) / WEEK_MS) * WEEK_MS - MONDAY_SHIFT;

export const spanOf = (ledger: readonly Evidence[], done: boolean, nowMs: number): TaskSpan | undefined => {
  const times = ledger.map((entry) => Date.parse(entry.at)).filter((ms) => Number.isFinite(ms));
  const gate = ledger.findLast((entry) => entry.check === GATE_CHECK && entry.status === "passed");
  if (times.length === 0) return undefined;
  const finished = done && gate !== undefined;
  return { start: Math.min(...times), end: finished ? Date.parse(gate.at) : nowMs, finished, activity: times };
};

const loadOf = (spans: readonly TaskSpan[], from: number): WeekLoad => {
  const to = from + WEEK_MS;
  const open = spans.filter((span) => span.start < to && span.end >= from);
  const closing = open.filter((span) => span.finished && span.end < to);
  const stalled = open.filter((span) => !closing.includes(span) && !span.activity.some((ms) => ms >= from && ms < to));
  return {
    week: new Date(from).toISOString().slice(0, 10),
    open: open.length,
    finished: closing.length,
    stalled: stalled.length,
  };
};

export const weekLoads = (spans: readonly TaskSpan[], nowMs: number): readonly WeekLoad[] => {
  if (spans.length === 0) return [];
  const loads: WeekLoad[] = [];
  for (let from = weekStart(Math.min(...spans.map((span) => span.start))); from + WEEK_MS <= nowMs; from += WEEK_MS) {
    loads.push(loadOf(spans, from));
  }
  return loads;
};

export const proposeLimit = (loads: readonly WeekLoad[]): LimitProposal | undefined => {
  const flowing = loads.filter((load) => load.open > 0 && load.finished > 0 && load.stalled === 0);
  if (flowing.length < MIN_FLOWING_WEEKS) return undefined;
  const best = Math.max(...flowing.map((load) => load.open));
  const overloaded = loads.filter((load) => load.stalled > 0 && load.open > 1);
  const ceiling = Math.min(best, ...overloaded.map((load) => load.open - 1));
  return {
    limit: Math.max(1, ceiling),
    weeks: [...flowing, ...overloaded].sort((a, b) => a.week.localeCompare(b.week)),
  };
};

export const historyLimit = (
  runtime: Pick<Runtime, "readText" | "homeDir" | "now">,
  paths: FmPaths,
  tasks: readonly KnownTask[],
): LimitProposal | undefined => {
  const nowMs = Date.parse(runtime.now());
  const spans = tasks
    .filter((task) => !task.contract.implicit)
    .flatMap((task) => spanOf(readLedger(runtime, paths.evidence(task.contract.id)), task.done, nowMs) ?? []);
  return proposeLimit(weekLoads(spans, nowMs));
};
