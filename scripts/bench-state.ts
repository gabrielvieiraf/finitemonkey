import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord, type JsonObject } from "../src/core/parsed.js";
import { parseYaml } from "../src/core/yaml/parse.js";
import { jsonLines } from "./bench-transcript.js";

export const text = (dir: string, path: string): string | undefined =>
  existsSync(join(dir, path)) ? readFileSync(join(dir, path), "utf8") : undefined;

export const json = (dir: string, path: string): JsonObject | undefined => {
  const raw = text(dir, path);
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const yaml = (dir: string, path: string): JsonObject | undefined => {
  const raw = text(dir, path);
  if (raw === undefined) return undefined;
  const parsed = parseYaml(raw);
  return parsed.ok && isRecord(parsed.value) ? parsed.value : undefined;
};

export const lines = (dir: string, path: string): readonly JsonObject[] => jsonLines(text(dir, path) ?? "");

export const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
export const records = (value: unknown): readonly JsonObject[] => (Array.isArray(value) ? value.filter(isRecord) : []);
export const unique = (items: readonly string[]): string[] => [...new Set(items)].sort();
