import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { readLedger } from "../evidence/ledger.js";
import { type Evidence, GATE_CHECK } from "../evidence/types.js";
import type { FmPaths } from "../task/paths.js";

export const GAIN_SCHEMA = "finitemonkey/gain@1";
export const DAY_MS = 86_400_000;
const SAVE_WINDOW_MS = DAY_MS;

export interface GainCounts {
  readonly blocks: number;
  readonly saves: number;
  readonly releases: number;
  readonly falsePositives: number;
  readonly gateRuns: number;
  readonly gateFailed: number;
  readonly gateUnverified: number;
  readonly gateMs: number;
}

export interface GainReport {
  readonly schema: typeof GAIN_SCHEMA;
  readonly days: number;
  readonly from: string;
  readonly to: string;
  readonly current: GainCounts;
  readonly previous: GainCounts;
}

interface LogLine {
  readonly at: number;
  readonly event: string;
}

const readLog = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly LogLine[] => {
  const text = runtime.readText(paths.log);
  if (!text.ok) return [];
  return text.value.split("\n").flatMap((line): LogLine[] => {
    const parsed = parseJsonObject(line);
    if (!parsed.ok || !isRecord(parsed.value)) return [];
    const { at, event } = parsed.value;
    const time = typeof at === "string" ? Date.parse(at) : Number.NaN;
    return typeof event === "string" && Number.isFinite(time) ? [{ at: time, event }] : [];
  });
};

const readGates = (runtime: Pick<Runtime, "readText" | "listDir">, paths: FmPaths): readonly Evidence[] => {
  const listed = runtime.listDir(toAbsolutePath(join(paths.dir, "evidence")));
  const files = listed.ok ? listed.value.filter((name) => name.endsWith(".jsonl")) : [];
  return files
    .flatMap((name) => readLedger(runtime, paths.evidence(name.replace(/\.jsonl$/, ""))))
    .filter((entry) => entry.check === GATE_CHECK);
};

const countsIn = (log: readonly LogLine[], gates: readonly Evidence[], from: number, to: number): GainCounts => {
  const inWindow = (at: number): boolean => at >= from && at < to;
  const lines = log.filter((line) => inWindow(line.at));
  const runs = gates.filter((entry) => inWindow(Date.parse(entry.at)));
  const passedAt = gates.filter((entry) => entry.status === "passed").map((entry) => Date.parse(entry.at));
  const blocks = lines.filter((line) => line.event === "guard_block");
  return {
    blocks: blocks.length,
    saves: blocks.filter((block) => passedAt.some((at) => at > block.at && at - block.at <= SAVE_WINDOW_MS)).length,
    releases: lines.filter((line) => line.event === "person.allow").length,
    falsePositives:
      lines.filter((line) => line.event === "person.allow").length +
      lines.filter((line) => line.event === "guard_false_positive").length,
    gateRuns: runs.length,
    gateFailed: runs.filter((entry) => entry.status === "failed").length,
    gateUnverified: runs.filter((entry) => entry.status === "unverified").length,
    gateMs: runs.reduce((sum, entry) => sum + (entry.durationMs ?? 0), 0),
  };
};

export const gainReport = (
  runtime: Pick<Runtime, "readText" | "listDir" | "now">,
  paths: FmPaths,
  days: number,
): GainReport => {
  const to = Date.parse(runtime.now());
  const from = to - days * DAY_MS;
  const log = readLog(runtime, paths);
  const gates = readGates(runtime, paths);
  return {
    schema: GAIN_SCHEMA,
    days,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    current: countsIn(log, gates, from, to + 1),
    previous: countsIn(log, gates, from - days * DAY_MS, from),
  };
};
