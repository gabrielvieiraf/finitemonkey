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
  readonly overridesWithReason: number;
  readonly overridesWithoutReason: number;
  readonly gateRuns: number;
  readonly gateFailed: number;
  readonly gateUnverified: number;
  readonly gateMs: number;
}

export interface ArmCounts {
  readonly tasks: number;
  readonly completed: number;
  readonly gateRuns: number;
  readonly gateFailed: number;
  readonly gateMedianMs: number;
}

export interface ArmComparison {
  readonly active: ArmCounts;
  readonly off: ArmCounts;
}

export interface GainReport {
  readonly schema: typeof GAIN_SCHEMA;
  readonly days: number;
  readonly from: string;
  readonly to: string;
  readonly current: GainCounts;
  readonly previous: GainCounts;
  readonly supervisorUsage?: Readonly<Record<string, number>>;
  readonly byArm?: Readonly<Record<string, ArmComparison>>;
}

interface LogLine {
  readonly at: number;
  readonly event: string;
  readonly reason: string;
}

const OVERRIDES: ReadonlySet<string> = new Set(["person.allow", "person.approve"]);

const readLog = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly LogLine[] => {
  const text = runtime.readText(paths.log);
  if (!text.ok) return [];
  return text.value.split("\n").flatMap((line): LogLine[] => {
    const parsed = parseJsonObject(line);
    if (!parsed.ok || !isRecord(parsed.value)) return [];
    const { at, event, reason } = parsed.value;
    const time = typeof at === "string" ? Date.parse(at) : Number.NaN;
    return typeof event === "string" && Number.isFinite(time)
      ? [{ at: time, event, reason: typeof reason === "string" ? reason.trim() : "" }]
      : [];
  });
};

export const readEvidence = (
  runtime: Pick<Runtime, "readText" | "listDir" | "homeDir">,
  paths: FmPaths,
): readonly Evidence[] => {
  const listed = runtime.listDir(toAbsolutePath(join(paths.dir, "evidence")));
  const files = listed.ok ? listed.value.filter((name) => name.endsWith(".jsonl")) : [];
  return files.flatMap((name) => readLedger(runtime, paths.evidence(name.replace(/\.jsonl$/, ""))));
};

interface Recovery {
  readonly failedAt: number;
  readonly passedAt: number;
}

export const recoveries = (evidence: readonly Evidence[]): readonly Recovery[] => {
  const byCheck = new Map<string, Evidence[]>();
  for (const entry of evidence) {
    const key = `${entry.task}\u0000${entry.check}`;
    byCheck.set(key, [...(byCheck.get(key) ?? []), entry]);
  }
  return [...byCheck.values()].flatMap((entries) => {
    const sorted = [...entries].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
    const found: Recovery[] = [];
    let failed: Evidence | undefined;
    for (const entry of sorted) {
      if (entry.status === "failed") failed = entry;
      else if (entry.status === "passed") {
        if (failed !== undefined && failed.treeHash !== entry.treeHash) {
          found.push({ failedAt: Date.parse(failed.at), passedAt: Date.parse(entry.at) });
        }
        failed = undefined;
      }
    }
    return found;
  });
};

const countsIn = (
  log: readonly LogLine[],
  gates: readonly Evidence[],
  fixed: readonly Recovery[],
  from: number,
  to: number,
): GainCounts => {
  const inWindow = (at: number): boolean => at >= from && at < to;
  const lines = log.filter((line) => inWindow(line.at));
  const runs = gates.filter((entry) => inWindow(Date.parse(entry.at)));
  const blocks = lines.filter((line) => line.event === "guard_block");
  const overrides = lines.filter((line) => OVERRIDES.has(line.event));
  return {
    blocks: blocks.length,
    saves: blocks.filter((block) =>
      fixed.some(
        (item) => item.failedAt <= block.at && item.passedAt > block.at && item.passedAt - block.at <= SAVE_WINDOW_MS,
      ),
    ).length,
    releases: lines.filter((line) => line.event === "person.allow").length,
    falsePositives: lines.filter((line) => line.event === "guard_false_positive").length,
    overridesWithReason: overrides.filter((line) => line.reason !== "").length,
    overridesWithoutReason: overrides.filter((line) => line.reason === "").length,
    gateRuns: runs.length,
    gateFailed: runs.filter((entry) => entry.status === "failed").length,
    gateUnverified: runs.filter((entry) => entry.status === "unverified").length,
    gateMs: runs.reduce((sum, entry) => sum + (entry.durationMs ?? 0), 0),
  };
};

const numbersIn = (text: string | undefined): Readonly<Record<string, number>> | undefined => {
  const parsed = text === undefined ? undefined : parseJsonObject(text);
  if (parsed?.ok !== true) return undefined;
  const entries = Object.entries(parsed.value).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]),
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
};

interface ArmLine {
  readonly feature: string;
  readonly task: string;
  readonly arm: "active" | "off";
}

export const readArms = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly ArmLine[] => {
  const text = runtime.readText(paths.log);
  if (!text.ok) return [];
  return text.value.split("\n").flatMap((line): ArmLine[] => {
    const parsed = parseJsonObject(line);
    if (!parsed.ok || parsed.value["event"] !== "experiment_arm") return [];
    const { feature, task, arm } = parsed.value;
    return typeof feature === "string" && typeof task === "string" && (arm === "active" || arm === "off")
      ? [{ feature, task, arm }]
      : [];
  });
};

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length === 0 ? 0 : (sorted[Math.floor((sorted.length - 1) / 2)] ?? 0);
};

const armCounts = (tasks: ReadonlySet<string>, gates: readonly Evidence[]): ArmCounts => {
  const runs = gates.filter((entry) => tasks.has(entry.task));
  return {
    tasks: tasks.size,
    completed: new Set(runs.filter((entry) => entry.status === "passed").map((entry) => entry.task)).size,
    gateRuns: runs.length,
    gateFailed: runs.filter((entry) => entry.status === "failed").length,
    gateMedianMs: median(runs.map((entry) => entry.durationMs ?? 0)),
  };
};

export const armComparison = (
  arms: readonly ArmLine[],
  gates: readonly Evidence[],
): Readonly<Record<string, ArmComparison>> => {
  const features = [...new Set(arms.map((line) => line.feature))].sort();
  return Object.fromEntries(
    features.map((feature) => {
      const assigned = new Map(arms.filter((line) => line.feature === feature).map((line) => [line.task, line.arm]));
      const tasksIn = (arm: "active" | "off"): ReadonlySet<string> =>
        new Set([...assigned].filter(([, value]) => value === arm).map(([task]) => task));
      return [feature, { active: armCounts(tasksIn("active"), gates), off: armCounts(tasksIn("off"), gates) }];
    }),
  );
};

export const gainReport = (
  runtime: Pick<Runtime, "readText" | "listDir" | "now" | "homeDir">,
  paths: FmPaths,
  days: number,
  usageText?: string,
  byArm = false,
): GainReport => {
  const to = Date.parse(runtime.now());
  const from = to - days * DAY_MS;
  const log = readLog(runtime, paths);
  const evidence = readEvidence(runtime, paths);
  const gates = evidence.filter((entry) => entry.check === GATE_CHECK);
  const fixed = recoveries(evidence);
  return {
    schema: GAIN_SCHEMA,
    days,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    current: countsIn(log, gates, fixed, from, to + 1),
    previous: countsIn(log, gates, fixed, from - days * DAY_MS, from),
    ...(() => {
      const usage = numbersIn(usageText);
      return usage === undefined ? {} : { supervisorUsage: usage };
    })(),
    ...(byArm ? { byArm: armComparison(readArms(runtime, paths), gates) } : {}),
  };
};
