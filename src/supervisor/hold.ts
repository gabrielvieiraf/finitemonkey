import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, parseConfigYaml } from "../git/project-config.js";
import { CONFIG_FILE } from "../install/layout.js";

export const HOLD_DIR_ENV = "FINITEMONKEY_HOLD_DIR";
export const USAGE_FILE = "usage.json";
export const GATE_HOLD_MS = 10 * 60_000;
export const BLOCK_HOLD_MS = 15 * 60_000;

export type HoldReason = "gate" | "block";

export interface Hold {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly project: string;
  readonly reason: HoldReason;
  readonly since: string;
  readonly until: string;
  readonly detail: string;
}

type HoldRuntime = Pick<Runtime, "readText" | "writeText" | "remove" | "mkdir" | "now">;

const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

export const supervisorEnabled = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): boolean => {
  const text = runtime.readText(toAbsolutePath(CONFIG_FILE, root));
  return text.ok && configAt(parseConfigYaml(text.value), "supervisor", "enabled") === "true";
};

export const holdDir = (runtime: Pick<Runtime, "readText">, root: AbsolutePath, env: Env): AbsolutePath | undefined => {
  if (!supervisorEnabled(runtime, root)) return undefined;
  const announced = env[HOLD_DIR_ENV];
  if (announced !== undefined && announced !== "") return toAbsolutePath(announced, root);
  const text = runtime.readText(toAbsolutePath(CONFIG_FILE, root));
  const configured = text.ok ? configAt(parseConfigYaml(text.value), "supervisor", "holdDir") : undefined;
  return typeof configured === "string" && configured !== "" ? toAbsolutePath(configured, root) : undefined;
};

export const holdPath = (dir: AbsolutePath, sessionId: string): AbsolutePath | undefined =>
  SAFE_ID.test(sessionId) ? toAbsolutePath(join(dir, `${sessionId}.hold.json`)) : undefined;

export const writeHold = (
  runtime: HoldRuntime,
  dir: AbsolutePath,
  hold: Omit<Hold, "schemaVersion" | "since" | "until">,
  ttlMs: number,
): boolean => {
  const path = holdPath(dir, hold.sessionId);
  if (path === undefined) return false;
  const now = runtime.now();
  const until = new Date(Date.parse(now) + ttlMs).toISOString();
  runtime.mkdir(dir);
  return runtime.writeText(path, `${JSON.stringify({ schemaVersion: 1, ...hold, since: now, until }, null, 2)}\n`).ok;
};

export const readHold = (
  runtime: Pick<Runtime, "readText">,
  dir: AbsolutePath,
  sessionId: string,
): Hold | undefined => {
  const path = holdPath(dir, sessionId);
  const text = path === undefined ? undefined : runtime.readText(path);
  const parsed = text?.ok === true ? parseJsonObject(text.value) : undefined;
  if (parsed?.ok !== true || !isRecord(parsed.value)) return undefined;
  const { reason, since, until, project, detail } = parsed.value;
  if ((reason !== "gate" && reason !== "block") || typeof since !== "string" || typeof until !== "string")
    return undefined;
  return {
    schemaVersion: 1,
    sessionId,
    project: typeof project === "string" ? project : "",
    reason,
    since,
    until,
    detail: typeof detail === "string" ? detail : "",
  };
};

export const holdActive = (hold: Hold | undefined, now: string): boolean =>
  hold !== undefined && Date.parse(hold.until) > Date.parse(now);

export const releaseHold = (runtime: Pick<Runtime, "remove">, dir: AbsolutePath, sessionId: string): void => {
  const path = holdPath(dir, sessionId);
  if (path !== undefined) runtime.remove(path);
};
