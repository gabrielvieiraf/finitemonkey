import { costFile, type CostLine, readCost } from "../bridge/cost.js";
import { isRecord, type JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { KIND_SPECS, type ProviderKind } from "./kinds.js";

export interface Usage {
  readonly model: string;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly usd: number;
  readonly durationMs: number;
}

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

const modelOf = (envelope: JsonObject): string => {
  const models = envelope["modelUsage"];
  const first = isRecord(models) ? Object.keys(models)[0] : undefined;
  return first ?? "claude";
};

export const usageOf = (envelope: JsonObject): Usage => {
  const usage = isRecord(envelope["usage"]) ? envelope["usage"] : {};
  return {
    model: modelOf(envelope),
    input: count(usage["input_tokens"]),
    output: count(usage["output_tokens"]),
    cacheRead: count(usage["cache_read_input_tokens"]),
    cacheWrite: count(usage["cache_creation_input_tokens"]),
    usd: count(envelope["total_cost_usd"]),
    durationMs: count(envelope["duration_ms"]),
  };
};

export const recordUsage = (
  runtime: Pick<Runtime, "appendText" | "now">,
  paths: FmPaths,
  entry: { readonly kind: ProviderKind; readonly task: string; readonly usage: Usage },
): void => {
  const { usage } = entry;
  const line = {
    model: usage.model,
    agent: null,
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    at: runtime.now(),
    task: entry.task,
    arms: [],
    usd: usage.usd,
    kind: entry.kind,
    durationMs: usage.durationMs,
  };
  runtime.appendText(costFile(paths), `${JSON.stringify(line)}\n`);
};

export const providerLines = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly CostLine[] =>
  readCost(runtime, paths).filter((line) => line.kind !== undefined);

export const spentToday = (runtime: Pick<Runtime, "readText" | "now">, paths: FmPaths): number => {
  const day = runtime.now().slice(0, 10);
  return providerLines(runtime, paths)
    .filter((line) => line.at.slice(0, 10) === day)
    .reduce((total, line) => total + line.usd, 0);
};

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

export interface Estimate {
  readonly usd: number;
  readonly source: "median" | "default";
  readonly calls: number;
}

export const estimateOf = (runtime: Pick<Runtime, "readText">, paths: FmPaths, kind: ProviderKind): Estimate => {
  const earlier = providerLines(runtime, paths).filter((line) => line.kind === kind);
  return earlier.length === 0
    ? { usd: KIND_SPECS[kind].defaultUsd, source: "default", calls: 0 }
    : { usd: median(earlier.map((line) => line.usd)), source: "median", calls: earlier.length };
};
