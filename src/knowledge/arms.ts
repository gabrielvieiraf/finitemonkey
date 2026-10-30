import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import { type Evidence, GATE_CHECK } from "../evidence/types.js";
import { readArms, readEvidence } from "../gain/gain.js";
import { policyNumber } from "../policy/numbers.js";
import { loadPolicy } from "../policy/policy.js";
import type { FmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";

export const KNOWLEDGE_SOURCES = ["knowledge-claims", "learnings"] as const;
export const DEMOTED_FILE = "demoted.json";
export const DEFAULT_DEMOTE_AFTER = 20;
export const DEFAULT_EQUIVALENCE_MARGIN_TENTHS = 5;
const Z95 = 1.96;

export type KnowledgeSource = (typeof KNOWLEDGE_SOURCES)[number];

export interface ArmOutcome {
  readonly tasks: number;
  readonly attempts: number | null;
  readonly falseDone: number | null;
  readonly tokens: number | null;
}

export interface SourceReport {
  readonly source: string;
  readonly active: ArmOutcome;
  readonly off: ArmOutcome;
  readonly effect: number | null;
  readonly interval: readonly [number, number] | null;
  readonly cost: number | null;
  readonly demoted: boolean;
}

export const demotedPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, DEMOTED_FILE));

export const readDemoted = (runtime: Pick<Runtime, "readText">, paths: FmPaths): ReadonlySet<string> => {
  const raw = runtime.readText(demotedPath(paths));
  const parsed = raw.ok ? parseJsonObject(raw.value) : undefined;
  const list = parsed?.ok === true ? parsed.value["sources"] : undefined;
  return new Set(
    Array.isArray(list)
      ? list.flatMap((item: unknown) => (isRecord(item) && typeof item["source"] === "string" ? [item["source"]] : []))
      : [],
  );
};

export const recordInjected = (
  runtime: Pick<Runtime, "readText" | "appendText" | "now">,
  paths: FmPaths,
  source: KnowledgeSource,
  tokens: number,
): void => {
  logEvent(runtime, paths, "knowledge_injected", { source, task: readState(runtime, paths).active ?? "", tokens });
};

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const variance = (values: readonly number[]): number => {
  const center = mean(values) ?? 0;
  return values.length < 2 ? 0 : values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1);
};

const attemptsToGreen = (runs: readonly Evidence[]): number | undefined => {
  const passed = runs.findIndex((entry) => entry.status === "passed");
  return passed < 0 ? undefined : passed + 1;
};

const injectedTokens = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  source: string,
): ReadonlyMap<string, number> => {
  const text = runtime.readText(paths.log);
  const totals = new Map<string, number>();
  for (const line of text.ok ? text.value.split("\n") : []) {
    const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
    if (parsed?.ok !== true || parsed.value["event"] !== "knowledge_injected" || parsed.value["source"] !== source)
      continue;
    const { task, tokens } = parsed.value;
    if (typeof task === "string" && typeof tokens === "number") totals.set(task, (totals.get(task) ?? 0) + tokens);
  }
  return totals;
};

const outcome = (
  tasks: readonly string[],
  gates: ReadonlyMap<string, readonly Evidence[]>,
  tokens: ReadonlyMap<string, number>,
) => {
  const attempts = tasks.flatMap((task) => attemptsToGreen(gates.get(task) ?? []) ?? []);
  const falseDone = tasks.filter((task) => (gates.get(task) ?? []).some((entry) => entry.status === "failed")).length;
  return {
    values: attempts,
    summary: {
      tasks: tasks.length,
      attempts: mean(attempts),
      falseDone: tasks.length === 0 ? null : falseDone / tasks.length,
      tokens: mean(tasks.flatMap((task) => tokens.get(task) ?? [])),
    } satisfies ArmOutcome,
  };
};

export const sourceReports = (
  runtime: Pick<Runtime, "readText" | "listDir" | "homeDir">,
  paths: FmPaths,
): readonly SourceReport[] => {
  const policy = loadPolicy(runtime, paths.root);
  const arms = readArms(runtime, paths);
  const gates = new Map<string, Evidence[]>();
  for (const entry of readEvidence(runtime, paths).filter((item) => item.check === GATE_CHECK))
    gates.set(entry.task, [...(gates.get(entry.task) ?? []), entry]);
  const after = policyNumber(runtime, paths.root, ["knowledge", "demoteAfter"], DEFAULT_DEMOTE_AFTER);
  const margin =
    policyNumber(runtime, paths.root, ["knowledge", "equivalenceMarginTenths"], DEFAULT_EQUIVALENCE_MARGIN_TENTHS) / 10;
  const demoted = readDemoted(runtime, paths);
  return KNOWLEDGE_SOURCES.filter((source) => policy.experiments[source] === "random").map((source) => {
    const assigned = arms.filter((line) => line.feature === source);
    const tokens = injectedTokens(runtime, paths, source);
    const active = outcome(
      assigned.filter((line) => line.arm === "active").map((line) => line.task),
      gates,
      tokens,
    );
    const off = outcome(
      assigned.filter((line) => line.arm === "off").map((line) => line.task),
      gates,
      tokens,
    );
    const left = mean(active.values);
    const right = mean(off.values);
    const effect = left === null || right === null ? null : left - right;
    const spread =
      active.values.length < 2 || off.values.length < 2
        ? null
        : Z95 * Math.sqrt(variance(active.values) / active.values.length + variance(off.values) / off.values.length);
    const interval: readonly [number, number] | null =
      effect === null || spread === null ? null : [effect - spread, effect + spread];
    const enough = active.values.length >= after && off.values.length >= after;
    const equivalent = interval !== null && interval[0] >= -margin && interval[1] <= margin;
    return {
      source,
      active: active.summary,
      off: off.summary,
      effect,
      interval,
      cost: active.summary.tokens,
      demoted: demoted.has(source) || (enough && equivalent),
    };
  });
};

export const writeDemotions = (
  runtime: Pick<Runtime, "readText" | "writeText" | "mkdir" | "appendText" | "now">,
  paths: FmPaths,
  reports: readonly SourceReport[],
): readonly string[] => {
  const before = readDemoted(runtime, paths);
  const fresh = reports.filter((report) => report.demoted && !before.has(report.source));
  if (fresh.length === 0) return [];
  const all = [...before]
    .map((source) => ({ source }))
    .concat(
      fresh.map((report) => ({
        source: report.source,
        at: runtime.now(),
        effect: report.effect,
        interval: report.interval,
      })),
    );
  runtime.mkdir(paths.dir);
  runtime.writeText(demotedPath(paths), `${JSON.stringify({ sources: all }, null, 2)}\n`);
  for (const report of fresh) logEvent(runtime, paths, "knowledge_demoted", { source: report.source });
  return fresh.map((report) => report.source);
};
