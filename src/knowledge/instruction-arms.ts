import type { JsonObject } from "../core/parsed.js";
import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import { armOf } from "../policy/experiment.js";
import { loadBasePolicy } from "../policy/policy.js";
import type { FmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";

export const INSTRUCTION_SOURCES = ["agents-md", "claude-md", "native-memory", "rules-section"] as const;
export const DROP_EVENT = "experiment_drop";
export const UNSUPPORTED_EVENT = "experiment_drop_unsupported";

export type InstructionSource = (typeof INSTRUCTION_SOURCES)[number];
export type DropSupport = "supported" | "unsupported" | null;

export const isInstructionSource = (value: string): value is InstructionSource =>
  INSTRUCTION_SOURCES.some((source) => source === value);

export const logEntries = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  events: readonly string[],
): readonly JsonObject[] => {
  const text = runtime.readText(paths.log);
  if (!text.ok) return [];
  return text.value.split("\n").flatMap((line): JsonObject[] => {
    if (line.trim() === "" || !events.some((event) => line.includes(event))) return [];
    const parsed = parseJsonObject(line);
    const event = parsed.ok ? parsed.value["event"] : undefined;
    return parsed.ok && typeof event === "string" && events.includes(event) ? [parsed.value] : [];
  });
};

export const withheldSources = (
  runtime: Pick<Runtime, "readText" | "homeDir">,
  paths: FmPaths,
): readonly InstructionSource[] => {
  const task = readState(runtime, paths).active;
  if (task === undefined) return [];
  const policy = loadBasePolicy(runtime, paths.root);
  return INSTRUCTION_SOURCES.filter(
    (source) => policy.experiments[source] === "random" && armOf(task, source) === "off",
  );
};

export const recordDrop = (
  runtime: Pick<Runtime, "readText" | "appendText" | "now">,
  paths: FmPaths,
  source: InstructionSource,
  section: string | undefined,
): void => {
  const task = readState(runtime, paths).active ?? "";
  if (section === undefined) logEvent(runtime, paths, UNSUPPORTED_EVENT, { feature: source, task });
  else logEvent(runtime, paths, DROP_EVENT, { feature: source, task, section });
};

export const dropSupport = (runtime: Pick<Runtime, "readText">, paths: FmPaths): ReadonlyMap<string, DropSupport> => {
  const support = new Map<string, DropSupport>();
  for (const entry of logEntries(runtime, paths, [DROP_EVENT, UNSUPPORTED_EVENT])) {
    const feature = entry["feature"];
    if (typeof feature !== "string" || !isInstructionSource(feature)) continue;
    const dropped = entry["event"] === DROP_EVENT && typeof entry["section"] === "string";
    if (dropped) support.set(feature, "supported");
    else if (support.get(feature) !== "supported") support.set(feature, "unsupported");
  }
  return support;
};
