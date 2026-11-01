import type { Runtime } from "../core/runtime.js";
import type { Translate } from "../i18n/translate.js";
import { featureMode } from "../policy/feature.js";
import type { FmPaths } from "../task/paths.js";
import type { XrayRow } from "./response.js";
import { appendEntry, entryId, readEntries } from "./store.js";
import {
  flagsFor,
  TRIAGE_CLAIMS_PER_FLAG,
  TRIAGE_FEATURE,
  TRIAGE_FLAGS_PER_TASK,
  type TriageCount,
  triageCount,
} from "./triage.js";
import type { TriageTrigger } from "./triage-triggers.js";
import { JUDGE_FEATURE, type JudgeEntry } from "./types.js";

type TriageRuntime = Pick<Runtime, "readText" | "homeDir" | "appendText" | "now" | "mkdir">;

export interface TriageRequest {
  readonly task: string;
  readonly trigger: TriageTrigger;
  readonly pick: (entries: readonly JudgeEntry[]) => readonly XrayRow[];
}

export const triageOff = (runtime: Pick<Runtime, "readText" | "homeDir">, paths: FmPaths): boolean =>
  featureMode(runtime, paths, JUDGE_FEATURE) === "off" || featureMode(runtime, paths, TRIAGE_FEATURE) === "off";

const fresh = (rows: readonly XrayRow[], flagged: readonly string[]): readonly XrayRow[] => {
  const seen = new Set(flagged);
  return rows.filter((row) => {
    if (seen.has(row.claim)) return false;
    seen.add(row.claim);
    return true;
  });
};

export const raiseTriage = (runtime: TriageRuntime, paths: FmPaths, request: TriageRequest): readonly XrayRow[] => {
  if (triageOff(runtime, paths)) return [];
  const entries = readEntries(runtime, paths);
  const flagged = flagsFor(entries, request.task);
  const rows = fresh(request.pick(entries), flagged.claims).slice(0, TRIAGE_CLAIMS_PER_FLAG);
  if (rows.length === 0 || flagged.flags >= TRIAGE_FLAGS_PER_TASK) return [];
  const flag = entryId("t", request.task, runtime.now());
  for (const row of rows)
    appendEntry(runtime, paths, {
      type: "signal",
      id: entryId("g", request.task, row.claim),
      at: runtime.now(),
      family: "triage-flag",
      confidence: 0,
      state: "shadow",
      ref: [request.task, flag, row.claim, request.trigger].join("\u0000"),
    });
  return rows;
};

const HEADS = {
  document: "judge.triage.head",
  decision: "judge.triage.head_decision",
  commit: "judge.triage.head_commit",
  research: "judge.triage.head_research",
} as const satisfies Readonly<Record<TriageTrigger, string>>;

export const triageLines = (t: Translate, trigger: TriageTrigger, rows: readonly XrayRow[]): readonly string[] =>
  rows.length === 0
    ? []
    : [
        t(HEADS[trigger], { count: rows.length }),
        ...rows.map((row) => t("judge.triage.row", { claim: row.claim, band: row.band, text: row.text })),
      ];

export const triageShown = (runtime: Pick<Runtime, "readText" | "homeDir">, paths: FmPaths): boolean =>
  featureMode(runtime, paths, TRIAGE_FEATURE) === "active" && featureMode(runtime, paths, JUDGE_FEATURE) !== "off";

export const shownTriage = (
  runtime: Pick<Runtime, "readText" | "homeDir">,
  paths: FmPaths,
  t: Translate,
  trigger: TriageTrigger,
  rows: readonly XrayRow[],
): readonly string[] => (triageShown(runtime, paths) ? triageLines(t, trigger, rows) : []);

export const triageNow = (runtime: Pick<Runtime, "readText" | "homeDir">, paths: FmPaths): TriageCount | null => {
  if (triageOff(runtime, paths)) return null;
  const count = triageCount(readEntries(runtime, paths));
  return count.flagged === 0 ? null : count;
};
