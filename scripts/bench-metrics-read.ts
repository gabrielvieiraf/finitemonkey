import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { accept, type JsonObject, type Parsed, reject } from "../src/core/parsed.js";
import { jsonLines } from "./bench-transcript.js";

export const RUNS_FILE = "runs.jsonl";
export const RUN_LOG = "runs/<run>/log.jsonl";

export interface RunRow {
  readonly record: JsonObject;
  readonly log: readonly JsonObject[];
}

export interface MetricsInput {
  readonly runs: readonly RunRow[];
  readonly sizes: Readonly<Record<string, string>>;
}

const readIfAny = (file: string): string => (existsSync(file) ? readFileSync(file, "utf8") : "");

export const loadRuns = (dir: string): Parsed<readonly RunRow[]> => {
  const file = join(dir, RUNS_FILE);
  if (!existsSync(file)) return reject(`${file} does not exist; point --runs at a bench output folder`);
  return accept(
    jsonLines(readFileSync(file, "utf8")).map((record) => ({
      record,
      log: typeof record["run"] === "string" ? jsonLines(readIfAny(join(dir, "runs", record["run"], "log.jsonl"))) : [],
    })),
  );
};

export const armOf = (row: RunRow): string => (typeof row.record["arm"] === "string" ? row.record["arm"] : "unknown");

export const numberAt = (record: JsonObject, key: string): number | undefined => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

export const booleanAt = (record: JsonObject, key: string): boolean | undefined => {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
};

export const eventsOf = (row: RunRow, event: string): readonly JsonObject[] =>
  row.log.filter((line) => line["event"] === event);

export const secondsAt = (record: JsonObject): number | undefined => {
  const at = record["at"];
  if (typeof at !== "string") return undefined;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? undefined : ms / 1000;
};
