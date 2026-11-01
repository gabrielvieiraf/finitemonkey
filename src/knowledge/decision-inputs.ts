import { readCost } from "../bridge/cost.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { readPending } from "../ricochete/divergence.js";
import type { FmPaths } from "../task/paths.js";

export const DIVERGENCE_EVENT = "divergence.outcome";

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const loggedReadings = (runtime: Pick<Runtime, "readText">, paths: FmPaths, task: string): readonly string[] => {
  const log = runtime.readText(paths.log);
  if (!log.ok) return [];
  return log.value.split("\n").flatMap((line) => {
    const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
    const value = parsed?.ok === true && isRecord(parsed.value) ? parsed.value : undefined;
    if (value?.["event"] !== DIVERGENCE_EVENT || value["task"] !== task) return [];
    const input = typeof value["input"] === "string" ? value["input"] : "";
    return strings(value["options"]).map((option) => `${option} (input ${input})`);
  });
};

export const divergenceAlternatives = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  task: string,
): readonly string[] => {
  const pending = readPending(runtime, paths).pending[task];
  const open =
    pending === undefined
      ? []
      : pending.options.map((option) => `${option.letter}: ${option.output} (input ${pending.input})`);
  return [...new Set([...loggedReadings(runtime, paths, task), ...open])];
};

export const usdFor = (runtime: Pick<Runtime, "readText">, paths: FmPaths, task: string): number | null => {
  const lines = readCost(runtime, paths).filter((line) => line.task === task);
  return lines.length === 0 ? null : Math.round(lines.reduce((total, line) => total + line.usd, 0) * 10_000) / 10_000;
};
