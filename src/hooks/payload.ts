import { accept, type JsonObject, optionalString, type Parsed, parseJsonObject, reject } from "../core/parsed.js";
import type { HookEvent } from "./events.js";

export interface HookPayload {
  readonly hookEventName: string | undefined;
  readonly sessionId: string | undefined;
  readonly cwd: string | undefined;
  readonly stopHookActive: boolean;
  readonly raw: JsonObject;
}

export const EMPTY_PAYLOAD: HookPayload = {
  hookEventName: undefined,
  sessionId: undefined,
  cwd: undefined,
  stopHookActive: false,
  raw: {},
};

export const parseHookPayload = (event: HookEvent, text: string, interactive: boolean): Parsed<HookPayload> => {
  if (interactive && text.trim() === "") return accept(EMPTY_PAYLOAD);
  const parsed = parseJsonObject(text);
  if (!parsed.ok) return reject(`stdin: ${parsed.error}`);
  const payload: HookPayload = {
    hookEventName: optionalString(parsed.value, "hook_event_name"),
    sessionId: optionalString(parsed.value, "session_id"),
    cwd: optionalString(parsed.value, "cwd"),
    stopHookActive: parsed.value["stop_hook_active"] === true,
    raw: parsed.value,
  };
  if (payload.hookEventName !== undefined && payload.hookEventName !== event) {
    return reject(`payload is for ${payload.hookEventName}, not ${event}`);
  }
  return accept(payload);
};
