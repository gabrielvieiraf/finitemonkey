import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { DATA_DIR } from "../core/data-dir.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { bypassesFile, DENIED_FILE } from "../guards/bypass/ledger.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { claudeVersion, PROBE_EVENTS_FILE } from "./probe.js";
import { type Check, type CheckFinding, finding } from "./types.js";

export const BYPASS_CACHE_FILE = "bypass-probe.json";
export const BYPASS_OUTCOMES = ["fired", "missed", "held", "inconclusive"] as const;

export type BypassOutcome = (typeof BYPASS_OUTCOMES)[number];

export interface BypassFacts {
  readonly denied: boolean;
  readonly ran: boolean;
  readonly recorded: boolean;
}

export interface BypassProbe {
  readonly version: string;
  readonly at: string;
  readonly outcome: BypassOutcome;
  readonly instructions: number;
}

export const classifyBypass = (facts: BypassFacts): BypassOutcome => {
  if (!facts.denied) return "inconclusive";
  if (facts.recorded) return "fired";
  return facts.ran ? "missed" : "held";
};

export const BYPASS_PROBE_TOOL = "Write";
export const BYPASS_PROBE_FILE = `${DATA_DIR}/cache/probe-bypass.txt`;

const mentionsTool = (text: string): boolean => text.includes(`"tool":"${BYPASS_PROBE_TOOL}"`);

export const bypassFacts = (runtime: Pick<Runtime, "readText" | "stat">, paths: FmPaths): BypassFacts => {
  const denied = runtime.readText(paths.cache(DENIED_FILE));
  const bypasses = runtime.readText(bypassesFile(paths));
  const recorded = bypasses.ok && bypasses.value.split("\n").some(mentionsTool);
  return {
    denied: recorded || (denied.ok && mentionsTool(denied.value.replace(/\s+/g, ""))),
    ran: runtime.stat(toAbsolutePath(join(paths.root, BYPASS_PROBE_FILE))) !== undefined,
    recorded,
  };
};

export const capturedInstructions = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  id: string,
): readonly Readonly<Record<string, unknown>>[] => {
  const text = runtime.readText(paths.cache(PROBE_EVENTS_FILE));
  if (!text.ok) return [];
  return text.value.split("\n").flatMap((line) => {
    const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
    if (parsed?.ok !== true || parsed.value["id"] !== id || parsed.value["event"] !== "InstructionsLoaded") return [];
    const payload = parsed.value["payload"];
    return isRecord(payload) ? [payload] : [];
  });
};

const readCache = (runtime: Pick<Runtime, "readText">, paths: FmPaths): Readonly<Record<string, unknown>> => {
  const text = runtime.readText(paths.cache(BYPASS_CACHE_FILE));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  return parsed?.ok === true ? parsed.value : {};
};

export const readBypassProbe = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  version: string,
): BypassProbe | undefined => {
  const entry = readCache(runtime, paths)[version];
  if (!isRecord(entry)) return undefined;
  const outcome = BYPASS_OUTCOMES.find((item) => item === entry["outcome"]);
  if (outcome === undefined) return undefined;
  const at = entry["at"];
  const instructions = entry["instructions"];
  return {
    version,
    at: typeof at === "string" ? at : "",
    outcome,
    instructions: typeof instructions === "number" ? instructions : 0,
  };
};

export const writeBypassProbe = (
  runtime: Pick<Runtime, "readText" | "writeText">,
  paths: FmPaths,
  probe: BypassProbe,
): void => {
  const next = {
    ...readCache(runtime, paths),
    [probe.version]: { at: probe.at, outcome: probe.outcome, instructions: probe.instructions },
  };
  runtime.writeText(paths.cache(BYPASS_CACHE_FILE), `${JSON.stringify(next, null, 2)}\n`);
};

export const bypassFindings = (
  version: string | undefined,
  probe: BypassProbe | undefined,
): readonly CheckFinding[] => {
  if (version === undefined) return [];
  if (probe === undefined || probe.outcome === "inconclusive")
    return [finding("mods.bypass", "ok", "doctor.bypass.not_confirmed", { version })];
  const params = { version, at: probe.at };
  if (probe.outcome === "fired") return [finding("mods.bypass", "ok", "doctor.bypass.fired", params)];
  if (probe.outcome === "held") return [finding("mods.bypass", "ok", "doctor.bypass.held", params)];
  return [finding("mods.bypass", "warn", "doctor.bypass.missed", params, "doctor.bypass.missed_fix")];
};

export const checkBypassOrder: Check = (env) => {
  const version = claudeVersion(env.runtime);
  return bypassFindings(
    version,
    version === undefined ? undefined : readBypassProbe(env.runtime, fmPaths(env.root), version),
  );
};
