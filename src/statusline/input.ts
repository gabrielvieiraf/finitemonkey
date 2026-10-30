import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";

export interface RateWindow {
  readonly name: string;
  readonly percent: number;
}

export interface StatusInput {
  readonly rateLimits: readonly RateWindow[];
  readonly sessionId: string | undefined;
  readonly dir: string | undefined;
  readonly contextPercent: number | undefined;
  readonly raw: string;
  readonly version: string | undefined;
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const usedTokens = (usage: unknown): number | undefined => {
  if (!isRecord(usage)) return undefined;
  return (
    (num(usage["input_tokens"]) ?? 0) +
    (num(usage["cache_creation_input_tokens"]) ?? 0) +
    (num(usage["cache_read_input_tokens"]) ?? 0)
  );
};

const contextPercent = (record: JsonObject): number | undefined => {
  const window = record["context_window"];
  if (!isRecord(window)) return undefined;
  const direct = window["used_percentage"];
  if (typeof direct === "number" && Number.isFinite(direct)) return Math.round(direct);
  const size = window["context_window_size"];
  const used = usedTokens(window["current_usage"]);
  return typeof size === "number" && size > 0 && used !== undefined ? Math.round((used / size) * 100) : undefined;
};

const rateLimits = (value: unknown): readonly RateWindow[] =>
  isRecord(value)
    ? Object.entries(value).flatMap(([name, window]) => {
        const percent = isRecord(window) ? num(window["used_percentage"]) : undefined;
        return percent === undefined ? [] : [{ name, percent: Math.round(percent) }];
      })
    : [];

export const parseStatusInput = (raw: string): StatusInput => {
  const parsed = parseJsonObject(raw.trim() === "" ? "{}" : raw);
  const record = parsed.ok ? parsed.value : {};
  const workspace = isRecord(record["workspace"]) ? record["workspace"] : {};
  return {
    sessionId: text(record["session_id"]),
    dir: text(workspace["project_dir"]) ?? text(workspace["current_dir"]) ?? text(record["cwd"]),
    contextPercent: contextPercent(record),
    rateLimits: rateLimits(record["rate_limits"]),
    raw,
    version: text(record["version"]),
  };
};
