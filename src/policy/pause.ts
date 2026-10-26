import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import type { FmPaths } from "../task/paths.js";

export const PAUSE_FILE = "pause.json";

export interface Pause {
  readonly sessionId: string;
  readonly since: string;
  readonly by: "prompt" | "terminal";
}

export const readPause = (runtime: Pick<Runtime, "readText">, paths: FmPaths): Pause | undefined => {
  const text = runtime.readText(paths.cache(PAUSE_FILE));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  if (parsed?.ok !== true || !isRecord(parsed.value)) return undefined;
  const { sessionId, since, by } = parsed.value;
  if (typeof sessionId !== "string" || typeof since !== "string") return undefined;
  return { sessionId, since, by: by === "terminal" ? "terminal" : "prompt" };
};

export const pausedFor = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  sessionId: string | undefined,
): Pause | undefined => {
  const pause = readPause(runtime, paths);
  return pause !== undefined && sessionId !== undefined && pause.sessionId === sessionId ? pause : undefined;
};

export const setPause = (
  runtime: Pick<Runtime, "writeText" | "appendText" | "now">,
  paths: FmPaths,
  sessionId: string,
  by: Pause["by"],
): Pause => {
  const pause: Pause = { sessionId, since: runtime.now(), by };
  runtime.writeText(paths.cache(PAUSE_FILE), `${JSON.stringify(pause)}\n`);
  logEvent(runtime, paths, "gate_paused", { sessionId, by });
  return pause;
};

export const clearPause = (
  runtime: Pick<Runtime, "readText" | "remove" | "appendText" | "now">,
  paths: FmPaths,
  by: Pause["by"],
): Pause | undefined => {
  const pause = readPause(runtime, paths);
  if (pause === undefined) return undefined;
  runtime.remove(paths.cache(PAUSE_FILE));
  logEvent(runtime, paths, "gate_resumed", { sessionId: pause.sessionId, since: pause.since, by });
  return pause;
};
