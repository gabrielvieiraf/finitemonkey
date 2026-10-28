import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../../core/brand.js";
import type { JsonObject } from "../../core/parsed.js";
import type { Runtime } from "../../core/runtime.js";
import { readJsonFile, writeJsonFile } from "../../task/state.js";

export const WATCH_DIR = ".finitemonkey/ci-watch";

export interface WatchState {
  readonly startedAt: string;
  readonly failed: readonly string[];
}

const fileOf = (root: AbsolutePath, pr: number, extension: string): AbsolutePath =>
  toAbsolutePath(join(root, ...WATCH_DIR.split("/"), `pr-${String(pr)}.${extension}`));

export const readWatch = (runtime: Pick<Runtime, "readText" | "now">, root: AbsolutePath, pr: number): WatchState => {
  const value = readJsonFile(runtime, fileOf(root, pr, "json"));
  const failed = value?.["failed"];
  return {
    startedAt: typeof value?.["startedAt"] === "string" ? value["startedAt"] : runtime.now(),
    failed: Array.isArray(failed) ? failed.filter((sha): sha is string => typeof sha === "string") : [],
  };
};

export const writeWatch = (
  runtime: Pick<Runtime, "writeText" | "mkdir">,
  root: AbsolutePath,
  pr: number,
  state: WatchState,
): void => {
  runtime.mkdir(toAbsolutePath(join(root, ...WATCH_DIR.split("/"))));
  writeJsonFile(runtime, fileOf(root, pr, "json"), { startedAt: state.startedAt, failed: [...state.failed] });
};

export const recordEvidence = (
  runtime: Pick<Runtime, "appendText" | "mkdir" | "now">,
  root: AbsolutePath,
  pr: number,
  data: JsonObject,
): void => {
  runtime.mkdir(toAbsolutePath(join(root, ...WATCH_DIR.split("/"))));
  runtime.appendText(fileOf(root, pr, "jsonl"), `${JSON.stringify({ at: runtime.now(), pr, ...data })}\n`);
};
