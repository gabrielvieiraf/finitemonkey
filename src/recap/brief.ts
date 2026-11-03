import type { Runtime } from "../core/runtime.js";
import { readEvidence } from "../gain/gain.js";
import type { Translate } from "../i18n/translate.js";
import type { FmPaths } from "../task/paths.js";
import { DEFAULT_SINCE, sinceIso } from "./period.js";
import { SHIPPED_TYPES } from "./recap.js";
import { finishedTasks, periodCommits } from "./sources.js";

export interface RecapBrief {
  readonly tasks: number;
  readonly shipped: number;
}

export const recapBrief = (
  runtime: Pick<Runtime, "git" | "readText" | "listDir" | "homeDir" | "now">,
  paths: FmPaths,
): RecapBrief | undefined => {
  const since = sinceIso(DEFAULT_SINCE, runtime.now());
  if (since === undefined) return undefined;
  const tasks = finishedTasks(readEvidence(runtime, paths), since).length;
  const shipped = periodCommits(runtime, paths.root, since).filter((commit) => SHIPPED_TYPES.has(commit.type)).length;
  return tasks + shipped === 0 ? undefined : { tasks, shipped };
};

export const recapBriefLines = (t: Translate, brief: RecapBrief | undefined): readonly string[] =>
  brief === undefined ? [] : [t("focus.card.recap", { tasks: brief.tasks, shipped: brief.shipped })];
