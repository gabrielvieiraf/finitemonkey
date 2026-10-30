import type { Domain } from "../perfil/types.js";
import { DOMAINS } from "../perfil/types.js";
import { isoWeek } from "../signals/blind-band.js";
import { type ConceptId, domainOf } from "./concepts.js";
import { type ConceptEvent, stateOf } from "./evidence.js";

export const TRAJECTORY_SCHEMA = "finitemonkey/trajectory@1";
export const TRAJECTORY_FEATURE = "trajectory";
export const WEEKS = 12;
export const MIN_EVIDENCE = 6;
export const MIN_WEEKS = 2;

export interface HelpMark {
  readonly at: string;
  readonly domain: string;
  readonly criterion: string;
}

export interface Week {
  readonly week: string;
  readonly independent: number | null;
  readonly discernment: number | null;
  readonly assisted: number | null;
  readonly blindCovered: number;
  readonly blindBare: number;
  readonly unstable: number | null;
  readonly work: number | null;
  readonly evidence: number;
}

export type MarkKind = "ricochet" | "held";

export interface EvidenceRef {
  readonly kind: string;
  readonly at: string;
  readonly concept: ConceptId;
  readonly task: string | null;
  readonly file: string | null;
}

export interface Mark {
  readonly kind: MarkKind;
  readonly week: string;
  readonly concept: ConceptId;
  readonly at: string;
  readonly from: string | null;
  readonly evidence: readonly EvidenceRef[];
}

export interface DomainTrajectory {
  readonly domain: Domain;
  readonly status: "ok" | "no_data";
  readonly evidence: number;
  readonly weeks: readonly Week[];
  readonly marks: readonly Mark[];
  readonly position: string | null;
}

const DAY = 86_400_000;

export const weekKeys = (now: number, count = WEEKS): readonly string[] =>
  Array.from(
    { length: count },
    (_, index) => isoWeek(new Date(now - (count - 1 - index) * 7 * DAY).toISOString()) ?? "",
  );

const INDEPENDENT = new Set(["own_change", "own_repair"]);
const DISCERNMENT = new Set(["prediction_right", "check_right"]);

const refOf = (event: ConceptEvent): EvidenceRef => ({
  kind: event.kind,
  at: event.at,
  concept: event.concept,
  task: event.task ?? null,
  file: event.file ?? null,
});

export const marksOf = (events: readonly ConceptEvent[]): readonly Mark[] =>
  events.flatMap((event, index): Mark[] => {
    if (event.kind !== "failure_after_approval") return [];
    const before = events.slice(0, index).filter((item) => item.concept === event.concept);
    if (stateOf(before) === "demonstrated") return [];
    const accepted = before.filter((item) => item.kind === "exposure" && item.origin === "agent").slice(-1);
    const repair = events
      .slice(index + 1)
      .find((item) => item.concept === event.concept && item.kind === "own_repair" && item.origin === "person");
    const week = isoWeek(event.at) ?? "";
    const evidence = [...accepted, event, ...(repair === undefined ? [] : [repair])].map(refOf);
    const from = accepted[0] === undefined ? null : (isoWeek(accepted[0].at) ?? null);
    const kind = repair === undefined ? "ricochet" : "held";
    return [{ kind, week, concept: event.concept, at: event.at, from, evidence }];
  });

const WRONG = new Set(["prediction_wrong", "check_wrong"]);

export const unstableCount = (events: readonly ConceptEvent[]): number => {
  const right = new Set(events.filter((event) => DISCERNMENT.has(event.kind)).map((event) => event.concept));
  return new Set(
    events.filter((event) => WRONG.has(event.kind) && right.has(event.concept)).map((event) => event.concept),
  ).size;
};

const distinct = (events: readonly ConceptEvent[], keep: (event: ConceptEvent) => boolean): number =>
  new Set(events.filter(keep).map((event) => event.concept)).size;

const ACCEPTED = (event: ConceptEvent): boolean =>
  INDEPENDENT.has(event.kind) || (event.kind === "exposure" && event.origin === "agent");

interface Series {
  readonly independent: number;
  readonly discernment: number;
  readonly assisted: number;
}

const middle = (from: number, to: number): number => (to > from ? (from + to) / 2 : to);

export const landedLevel = (
  inWeek: readonly ConceptEvent[],
  upTo: readonly ConceptEvent[],
  series: Series,
): number | null => {
  const touched = [...new Set(inWeek.filter(ACCEPTED).map((event) => event.concept))];
  if (touched.length === 0) return null;
  const levels = touched.map((concept) => {
    const state = stateOf(upTo.filter((event) => event.concept === concept));
    if (state === "demonstrated") return middle(0, series.independent);
    if (state === "proximal") return middle(series.independent, series.discernment);
    return middle(series.discernment, Math.max(series.assisted, series.discernment + 1));
  });
  return Math.max(...levels);
};

export const trajectoryOf = (
  domain: Domain,
  all: readonly ConceptEvent[],
  helps: readonly HelpMark[],
  now: number,
): DomainTrajectory => {
  const events = all.filter((event) => domainOf(event.concept) === domain);
  const keys = weekKeys(now);
  const weighted = events.filter((event) => event.weight !== 0 || event.origin === "agent");
  const weeksWith = new Set(weighted.map((event) => isoWeek(event.at)));
  const marks = marksOf(events).filter((mark) => keys.includes(mark.week));
  const evidence = events.filter((event) => event.weight !== 0).length;
  const enough = evidence >= MIN_EVIDENCE && keys.filter((key) => weeksWith.has(key)).length >= MIN_WEEKS;
  const weeks = keys.map((key): Week => {
    const upTo = events.filter((event) => (isoWeek(event.at) ?? "") <= key);
    const inWeek = events.filter((event) => isoWeek(event.at) === key);
    const domainHelps = helps.filter((help) => help.domain === domain && isoWeek(help.at) === key);
    const has = inWeek.some((event) => event.weight !== 0 || event.origin === "agent");
    const independent = distinct(upTo, (event) => INDEPENDENT.has(event.kind));
    const discernment = Math.max(
      independent,
      distinct(upTo, (event) => DISCERNMENT.has(event.kind)),
    );
    const assisted = Math.max(
      discernment,
      distinct(upTo, (event) => ACCEPTED(event) || DISCERNMENT.has(event.kind)),
    );
    return {
      week: key,
      independent: has ? independent : null,
      discernment: has ? discernment : null,
      assisted: has ? assisted : null,
      blindCovered: domainHelps.filter((help) => help.criterion !== "none").length,
      blindBare: domainHelps.filter((help) => help.criterion === "none").length,
      unstable: has ? unstableCount(upTo) : null,
      work: has ? landedLevel(inWeek, upTo, { independent, discernment, assisted }) : null,
      evidence: inWeek.filter((event) => event.weight !== 0).length,
    };
  });
  const last = [...weeks].reverse().find((week) => week.work !== null);
  return {
    domain,
    status: enough ? "ok" : "no_data",
    evidence,
    weeks: enough ? weeks : [],
    marks: enough ? marks : [],
    position: enough && last !== undefined ? last.week : null,
  };
};

export const trajectories = (
  events: readonly ConceptEvent[],
  helps: readonly HelpMark[],
  now: number,
): readonly DomainTrajectory[] => DOMAINS.map((domain) => trajectoryOf(domain, events, helps, now));
