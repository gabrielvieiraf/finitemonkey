import { dirname } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { type CheckFinding, finding } from "./types.js";

export const PROBE_ID_ENV = "FINITEMONKEY_PROBE_ID";
export const PROBE_EVENTS_FILE = "probe-events.jsonl";
export const PROBE_CACHE_FILE = "probe.json";
export const PROBE_TIMEOUT_MS = 180_000;
export const PROBE_EXPECTED = ["PreToolUse", "SubagentStart", "PreToolUse:subagent", "Stop"] as const;

export const PROBE_PROMPT =
  "Hook probe from finitemonkey doctor. Use the Task tool to start one general-purpose subagent whose only job is to run the shell command `true` with the Bash tool and answer done. Then run `true` with the Bash tool yourself and stop. Do nothing else.";

export interface ProbeResult {
  readonly version: string;
  readonly at: string;
  readonly seen: readonly string[];
  readonly missing: readonly string[];
  readonly cached: boolean;
}

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const recordProbeEvent = (
  runtime: Pick<Runtime, "appendText" | "now">,
  paths: FmPaths,
  id: string,
  event: string,
  raw: Readonly<Record<string, unknown>>,
): void => {
  const agent = raw["agent_id"];
  const inside = typeof agent === "string" && agent !== "";
  const label = inside && event === "PreToolUse" ? "PreToolUse:subagent" : event;
  runtime.appendText(paths.cache(PROBE_EVENTS_FILE), `${JSON.stringify({ id, event: label, at: runtime.now() })}\n`);
};

export const probeEvents = (runtime: Pick<Runtime, "readText">, paths: FmPaths, id: string): readonly string[] => {
  const text = runtime.readText(paths.cache(PROBE_EVENTS_FILE));
  if (!text.ok) return [];
  const seen = text.value.split("\n").flatMap((line) => {
    const parsed = parseJsonObject(line);
    if (!parsed.ok || parsed.value["id"] !== id) return [];
    const event = parsed.value["event"];
    return typeof event === "string" ? [event] : [];
  });
  return [...new Set(seen)];
};

export const readProbeCache = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  version: string,
): ProbeResult | undefined => {
  const text = runtime.readText(paths.cache(PROBE_CACHE_FILE));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  const entry = parsed?.ok === true ? parsed.value[version] : undefined;
  if (!isRecord(entry)) return undefined;
  const at = entry["at"];
  return {
    version,
    at: typeof at === "string" ? at : "",
    seen: strings(entry["seen"]),
    missing: strings(entry["missing"]),
    cached: true,
  };
};

const writeProbeCache = (
  runtime: Pick<Runtime, "readText" | "writeText">,
  paths: FmPaths,
  result: ProbeResult,
): void => {
  const text = runtime.readText(paths.cache(PROBE_CACHE_FILE));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  const before = parsed?.ok === true ? parsed.value : {};
  const next = { ...before, [result.version]: { at: result.at, seen: result.seen, missing: result.missing } };
  runtime.writeText(paths.cache(PROBE_CACHE_FILE), `${JSON.stringify(next, null, 2)}\n`);
};

export const claudeVersion = (runtime: Pick<Runtime, "probe">): string | undefined => {
  const result = runtime.probe("claude", ["--version"], 5000);
  const version = result.stdout.trim().split(/\s+/)[0];
  return result.ok && version !== undefined && version !== "" ? version : undefined;
};

export const runProbe = (
  runtime: Pick<Runtime, "probe" | "exec" | "readText" | "writeText" | "appendText" | "now" | "mkdir">,
  paths: FmPaths,
): ProbeResult | undefined => {
  const version = claudeVersion(runtime);
  if (version === undefined) return undefined;
  const cached = readProbeCache(runtime, paths, version);
  if (cached !== undefined) return cached;
  const id = `probe-${runtime.now().replace(/[:.]/g, "-")}`;
  runtime.mkdir(toAbsolutePath(dirname(paths.cache(PROBE_CACHE_FILE))));
  runtime.exec({
    command: "claude",
    args: ["-p", PROBE_PROMPT, "--output-format", "json", "--max-turns", "6"],
    cwd: paths.root,
    timeoutMs: PROBE_TIMEOUT_MS,
    env: { [PROBE_ID_ENV]: id },
    unset: ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"],
  });
  const seen = probeEvents(runtime, paths, id);
  const result: ProbeResult = {
    version,
    at: runtime.now(),
    seen,
    missing: PROBE_EXPECTED.filter((event) => !seen.includes(event)),
    cached: false,
  };
  writeProbeCache(runtime, paths, result);
  return result;
};

export const brokenHooks = (runtime: Pick<Runtime, "readText">, paths: FmPaths, version: string): boolean =>
  (readProbeCache(runtime, paths, version)?.missing.length ?? 0) > 0;

export const probeFindings = (result: ProbeResult | undefined): readonly CheckFinding[] => {
  if (result === undefined) return [finding("hooks.probe", "warn", "doctor.probe.no_claude")];
  const params = { version: result.version, at: result.at, list: result.missing.join(", ") };
  return result.missing.length === 0
    ? [finding("hooks.probe", "ok", "doctor.probe.ok", params)]
    : [finding("hooks.probe", "fail", "doctor.probe.missing", params, "doctor.probe.fix")];
};
