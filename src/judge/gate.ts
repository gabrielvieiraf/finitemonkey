import type { Runtime } from "../core/runtime.js";
import { featureMode } from "../policy/feature.js";
import type { FmPaths } from "../task/paths.js";
import { resultsIn } from "./claims.js";
import { readEntries } from "./store.js";
import { JUDGE_FEATURE } from "./types.js";

export const judgeWanted = (runtime: Pick<Runtime, "readText" | "homeDir">, paths: FmPaths, task: string): boolean =>
  featureMode(runtime, paths, JUDGE_FEATURE) !== "off" &&
  resultsIn(readEntries(runtime, paths)).some((result) => result.task === task);
