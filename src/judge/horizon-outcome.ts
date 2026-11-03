import type { OutcomeMark } from "../conceitos/trajectory-splits.js";
import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import type { FmPaths } from "../task/paths.js";
import { bandDomain, latestHelps } from "./horizon.js";
import { readEntries } from "./store.js";
import type { HorizonEntry } from "./types.js";

export const HORIZON_OUTCOME_EVENT = "horizon.outcome";
export const OUTCOMES = ["recognizable", "out_of_reach"] as const;
export const OUTCOME_REASONS = ["accepted", "dismissed", "ignored", "ran_check", "edited", "answered"] as const;

export type Outcome = (typeof OUTCOMES)[number];
export type OutcomeReason = (typeof OUTCOME_REASONS)[number];

export const outcomeOfReason = (reason: OutcomeReason): Outcome =>
  reason === "dismissed" || reason === "ignored" ? "out_of_reach" : "recognizable";

export const helpDomain = (domain: string): string => bandDomain(domain.split("/")[0] ?? domain);

export const recordOutcome = (
  runtime: Pick<Runtime, "appendText" | "now">,
  paths: FmPaths,
  help: HorizonEntry,
  reason: OutcomeReason,
): boolean =>
  logEvent(runtime, paths, HORIZON_OUTCOME_EVENT, {
    help: help.id,
    outcome: outcomeOfReason(reason),
    reason,
    domain: helpDomain(help.domain),
    ...(help.task === undefined ? {} : { task: help.task }),
  });

interface LoggedOutcome extends OutcomeMark {
  readonly help: string;
}

export const outcomeMarks = (log: string): readonly LoggedOutcome[] =>
  log.split("\n").flatMap((line) => {
    if (!line.includes(HORIZON_OUTCOME_EVENT)) return [];
    const parsed = parseJsonObject(line);
    if (!parsed.ok || parsed.value["event"] !== HORIZON_OUTCOME_EVENT) return [];
    const { at, domain, help } = parsed.value;
    const outcome = OUTCOMES.find((item) => item === parsed.value["outcome"]);
    return typeof at === "string" && typeof domain === "string" && typeof help === "string" && outcome !== undefined
      ? [{ at, domain, help, outcome }]
      : [];
  });

export const openHelps = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  task: string,
): readonly HorizonEntry[] => {
  const log = runtime.readText(paths.log);
  const settled = new Set(outcomeMarks(log.ok ? log.value : "").map((item) => item.help));
  return latestHelps(readEntries(runtime, paths)).filter(
    (help) => help.task === task && help.state === "shown" && !settled.has(help.id),
  );
};

export const closeHorizon = (
  runtime: Pick<Runtime, "readText" | "appendText" | "now">,
  paths: FmPaths,
  task: string,
): number => openHelps(runtime, paths, task).filter((help) => recordOutcome(runtime, paths, help, "ignored")).length;
