import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";

export const REUSE_LOG = "reuse.json";
export const RETIRE_AFTER = 100;
export const RETIRE_BELOW = 0.2;

export type Outcome = "pending" | "reused" | "kept";

export interface Warning {
  readonly id: number;
  readonly at: string;
  readonly session: string;
  readonly name: string;
  readonly file: string;
  readonly existing: string;
  readonly outcome: Outcome;
}

export interface ReuseLog {
  readonly warnings: readonly Warning[];
  readonly retired: boolean;
}

export const reuseLogPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, REUSE_LOG));

const OUTCOMES: readonly Outcome[] = ["pending", "reused", "kept"];

const text = (raw: Readonly<Record<string, unknown>>, key: string): string => {
  const value = raw[key];
  return typeof value === "string" ? value : "";
};

export const readReuseLog = (runtime: Pick<Runtime, "readText">, paths: FmPaths): ReuseLog => {
  const raw = readJsonFile(runtime, reuseLogPath(paths));
  const list = Array.isArray(raw?.["warnings"]) ? raw["warnings"] : [];
  return {
    warnings: list.flatMap((item: unknown): Warning[] => {
      if (!isRecord(item)) return [];
      const outcome = OUTCOMES.find((value) => value === item["outcome"]) ?? "pending";
      const id = typeof item["id"] === "number" ? item["id"] : 0;
      return [
        {
          id,
          at: text(item, "at"),
          session: text(item, "session"),
          name: text(item, "name"),
          file: text(item, "file"),
          existing: text(item, "existing"),
          outcome,
        },
      ];
    }),
    retired: raw?.["retired"] === true,
  };
};

export const reuseStats = (log: ReuseLog): { readonly resolved: number; readonly reused: number } => {
  const resolved = log.warnings.filter((item) => item.outcome !== "pending");
  return { resolved: resolved.length, reused: resolved.filter((item) => item.outcome === "reused").length };
};

export const shouldRetire = (log: ReuseLog): boolean => {
  const stats = reuseStats(log);
  return stats.resolved >= RETIRE_AFTER && stats.reused / stats.resolved < RETIRE_BELOW;
};

export const writeReuseLog = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, log: ReuseLog): boolean => {
  const stats = reuseStats(log);
  return writeJsonFile(runtime, reuseLogPath(paths), {
    retired: log.retired,
    resolved: stats.resolved,
    reused: stats.reused,
    warnings: log.warnings.map((item) => ({ ...item })),
  }).ok;
};
