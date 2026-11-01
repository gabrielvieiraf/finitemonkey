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
import { type DropSupport, dropSupport, INSTRUCTION_SOURCES } from "./instruction-arms.js";
import { localizations, tokensPerTurn } from "./turn-measures.js";

export const KNOWLEDGE_SOURCES = ["knowledge-claims", "learnings"] as const;
export const ARM_SOURCES: readonly string[] = [...KNOWLEDGE_SOURCES, ...INSTRUCTION_SOURCES];
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
  readonly tokensPerTurn: number | null;
  readonly localization: number | null;
}

export interface SourceReport {
  readonly source: string;
  readonly active: ArmOutcome;
  readonly off: ArmOutcome;
  readonly effect: number | null;
  readonly interval: readonly [number, number] | null;
  readonly cost: number | null;
  readonly demoted: boolean;
  readonly support: DropSupport;
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

interface Measures {
  readonly gates: ReadonlyMap<string, readonly Evidence[]>;
  readonly tokens: ReadonlyMap<string, number>;
  readonly perTurn: ReadonlyMap<string, number>;
  readonly localized: ReadonlyMap<string, boolean>;
}

const share = (flags: readonly boolean[]): number | null =>
  flags.length === 0 ? null : flags.filter(Boolean).length / flags.length;

const outcome = (tasks: readonly string[], measures: Measures) => {
  const { gates, tokens } = measures;
  const attempts = tasks.flatMap((task) => attemptsToGreen(gates.get(task) ?? []) ?? []);
  const falseDone = tasks.filter((task) => (gates.get(task) ?? []).some((entry) => entry.status === "failed")).length;
  return {
    values: attempts,
    summary: {
      tasks: tasks.length,
      attempts: mean(attempts),
      falseDone: tasks.length === 0 ? null : falseDone / tasks.length,
      tokens: mean(tasks.flatMap((task) => tokens.get(task) ?? [])),
      tokensPerTurn: mean(tasks.flatMap((task) => measures.perTurn.get(task) ?? [])),
      localization: share(tasks.flatMap((task) => measures.localized.get(task) ?? [])),
    } satisfies ArmOutcome,
  };
};

const intervalOf = (active: readonly number[], off: readonly number[], effect: number | null) => {
  if (effect === null || active.length < 2 || off.length < 2) return null;
  const spread = Z95 * Math.sqrt(variance(active) / active.length + variance(off) / off.length);
  return [effect - spread, effect + spread] as const;
};

interface Context {
  readonly arms: ReturnType<typeof readArms>;
  readonly gates: ReadonlyMap<string, readonly Evidence[]>;
  readonly perTurn: ReadonlyMap<string, number>;
  readonly localized: ReadonlyMap<string, boolean>;
  readonly support: ReadonlyMap<string, DropSupport>;
  readonly demoted: ReadonlySet<string>;
  readonly after: number;
  readonly margin: number;
}

const reportFor = (runtime: Pick<Runtime, "readText">, paths: FmPaths, source: string, ctx: Context): SourceReport => {
  const assigned = ctx.arms.filter((line) => line.feature === source);
  const measures: Measures = { ...ctx, tokens: injectedTokens(runtime, paths, source) };
  const pick = (arm: "active" | "off") =>
    outcome(
      assigned.filter((line) => line.arm === arm).map((line) => line.task),
      measures,
    );
  const active = pick("active");
  const off = pick("off");
  const left = mean(active.values);
  const right = mean(off.values);
  const effect = left === null || right === null ? null : left - right;
  const interval = intervalOf(active.values, off.values, effect);
  const enough = active.values.length >= ctx.after && off.values.length >= ctx.after;
  const equivalent = interval !== null && interval[0] >= -ctx.margin && interval[1] <= ctx.margin;
  return {
    source,
    active: active.summary,
    off: off.summary,
    effect,
    interval,
    cost: active.summary.tokens,
    demoted: KNOWLEDGE_SOURCES.some((known) => known === source) && (ctx.demoted.has(source) || (enough && equivalent)),
    support: ctx.support.get(source) ?? null,
  };
};

export const sourceReports = (
  runtime: Pick<Runtime, "readText" | "listDir" | "homeDir">,
  paths: FmPaths,
): readonly SourceReport[] => {
  const policy = loadPolicy(runtime, paths.root);
  const gates = new Map<string, Evidence[]>();
  for (const entry of readEvidence(runtime, paths).filter((item) => item.check === GATE_CHECK))
    gates.set(entry.task, [...(gates.get(entry.task) ?? []), entry]);
  const ctx: Context = {
    arms: readArms(runtime, paths),
    gates,
    perTurn: tokensPerTurn(runtime, paths),
    localized: localizations(runtime, paths),
    support: dropSupport(runtime, paths),
    demoted: readDemoted(runtime, paths),
    after: policyNumber(runtime, paths.root, ["knowledge", "demoteAfter"], DEFAULT_DEMOTE_AFTER),
    margin:
      policyNumber(runtime, paths.root, ["knowledge", "equivalenceMarginTenths"], DEFAULT_EQUIVALENCE_MARGIN_TENTHS) /
      10,
  };
  return ARM_SOURCES.filter((source) => policy.experiments[source] === "random").map((source) =>
    reportFor(runtime, paths, source, ctx),
  );
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
