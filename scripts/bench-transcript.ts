import { isRecord, type JsonObject, parseJsonObject } from "../src/core/parsed.js";
import type { Arm } from "./bench-arms.js";

export interface Usage {
  readonly costUsd: number | undefined;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly turns: number | undefined;
  readonly model: string | undefined;
}

export interface Injection {
  readonly ok: boolean;
  readonly hooks: readonly string[];
  readonly problems: readonly string[];
}

export const jsonLines = (text: string): readonly JsonObject[] =>
  text.split("\n").flatMap((line) => {
    if (line.trim() === "") return [];
    const parsed = parseJsonObject(line);
    return parsed.ok ? [parsed.value] : [];
  });

const num = (record: JsonObject | undefined, key: string): number | undefined => {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const init = (lines: readonly JsonObject[]): JsonObject | undefined =>
  lines.find((line) => line["type"] === "system" && line["subtype"] === "init");

export const usageOf = (transcript: string): Usage => {
  const lines = jsonLines(transcript);
  const result = lines.findLast((line) => line["type"] === "result");
  const usage = isRecord(result?.["usage"]) ? result["usage"] : undefined;
  const tokens = (...keys: readonly string[]): number => keys.reduce((sum, key) => sum + (num(usage, key) ?? 0), 0);
  const model = init(lines)?.["model"];
  return {
    costUsd: num(result, "total_cost_usd"),
    inputTokens: tokens("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"),
    outputTokens: tokens("output_tokens"),
    turns: num(result, "num_turns"),
    model: typeof model === "string" ? model : undefined,
  };
};

const pluginNames = (transcript: string): readonly string[] | undefined => {
  const plugins: unknown = init(jsonLines(transcript))?.["plugins"];
  if (!Array.isArray(plugins)) return undefined;
  return plugins.flatMap((plugin: unknown) => {
    const name = isRecord(plugin) ? plugin["name"] : plugin;
    return typeof name === "string" ? [name] : [];
  });
};

const benchHooks = (log: string): readonly JsonObject[] =>
  jsonLines(log).filter((line) => line["event"] === "bench_hook");

const fmProblems = (hooks: readonly JsonObject[], run: string, plugins: readonly string[] | undefined): string[] => [
  ...(hooks.length === 0 ? ["no Finite Monkey hook ran with this run id"] : []),
  ...(hooks.some((hook) => hook["run"] !== run) ? ["a hook ran with another run id"] : []),
  ...(plugins !== undefined && !plugins.some((name) => name.startsWith("finitemonkey"))
    ? ["the session did not load the finitemonkey plugin"]
    : []),
];

const plainProblems = (hooks: readonly JsonObject[], transcript: string): string[] => [
  ...(hooks.length > 0 ? ["a Finite Monkey hook ran in the plain arm"] : []),
  ...(/finitemonkey/i.test(transcript) ? ["the plain transcript mentions finitemonkey"] : []),
];

export const checkInjection = (arm: Arm, run: string, transcript: string, log: string): Injection => {
  const hooks = benchHooks(log);
  const problems = arm.finitemonkey
    ? fmProblems(hooks, run, pluginNames(transcript))
    : plainProblems(hooks, transcript);
  const seen = [...new Set(hooks.flatMap((hook) => (typeof hook["hook"] === "string" ? [hook["hook"]] : [])))];
  return { ok: problems.length === 0, hooks: seen.sort(), problems };
};
