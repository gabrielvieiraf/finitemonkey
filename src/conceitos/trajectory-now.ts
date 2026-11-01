import { nowMs } from "../core/clock.js";
import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { isMuted, readBudget } from "../policy/budget.js";
import { featureMode } from "../policy/feature.js";
import { loadPolicy } from "../policy/policy.js";
import { HORIZON_EVENT } from "../signals/blind-band.js";
import type { FmPaths } from "../task/paths.js";
import { readConceptEvents } from "./evidence.js";
import { type DomainTrajectory, type HelpMark, trajectories, TRAJECTORY_FEATURE } from "./trajectory.js";
import { describeBand, landedIn } from "./trajectory-bands.js";

export interface TrajectoryNow {
  readonly domain: string;
  readonly week: string;
  readonly band: string | null;
  readonly ricochet: { readonly concept: string; readonly week: string } | null;
}

export const helpMarks = (log: string): readonly HelpMark[] =>
  log.split("\n").flatMap((line) => {
    if (!line.includes(HORIZON_EVENT)) return [];
    const parsed = parseJsonObject(line);
    if (!parsed.ok || parsed.value["event"] !== HORIZON_EVENT) return [];
    const { at, domain, criterion } = parsed.value;
    return typeof at === "string" && typeof domain === "string" && typeof criterion === "string"
      ? [{ at, domain, criterion }]
      : [];
  });

const latest = (items: readonly DomainTrajectory[]): DomainTrajectory | undefined =>
  items
    .filter((item) => item.status === "ok" && item.position !== null)
    .sort((a, b) => (b.position ?? "").localeCompare(a.position ?? "") || b.evidence - a.evidence)[0];

export const nowOf = (items: readonly DomainTrajectory[]): TrajectoryNow | null => {
  const item = latest(items);
  const week = item?.weeks.find((candidate) => candidate.week === item.position);
  if (item === undefined || week === undefined) return null;
  const band = landedIn(item, week);
  const ricochet = item.marks.filter((mark) => mark.kind === "ricochet").at(-1);
  return {
    domain: item.domain,
    week: week.week,
    band: band === undefined ? null : describeBand(band),
    ricochet: ricochet === undefined ? null : { concept: ricochet.concept, week: ricochet.week },
  };
};

export const trajectoryNowOf = (runtime: Runtime, paths: FmPaths): TrajectoryNow | null => {
  if (featureMode(runtime, paths, TRAJECTORY_FEATURE) !== "active") return null;
  const policy = loadPolicy(runtime, paths.root);
  if (isMuted(readBudget(runtime, paths), policy.alertBudget, nowMs(runtime), TRAJECTORY_FEATURE)) return null;
  const events = readConceptEvents(runtime, paths);
  if (events.length === 0) return null;
  const log = runtime.readText(paths.log);
  return nowOf(trajectories(events, helpMarks(log.ok ? log.value : ""), nowMs(runtime)));
};
