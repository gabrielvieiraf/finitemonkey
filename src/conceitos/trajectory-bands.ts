import type { DomainTrajectory, Mark, Week } from "./trajectory.js";

export type Band = "alone" | "proximal" | "unstable" | "blindCovered" | "blindBare" | "blind" | "beyond";
export type Group = "horizon" | "blind" | "discernment" | "proximal" | "alone";
export type BandStatus = "measured" | "calibration";

export interface BandInfo {
  readonly group: Group;
  readonly label: string;
  readonly status: BandStatus;
}

export const BANDS: Readonly<Record<Band, BandInfo>> = {
  alone: { group: "alone", label: "own change or repair, gate green", status: "measured" },
  proximal: { group: "proximal", label: "prediction or check right", status: "measured" },
  unstable: { group: "discernment", label: "unstable boundary", status: "calibration" },
  blindCovered: { group: "blind", label: "receives with criterion", status: "measured" },
  blindBare: { group: "blind", label: "receives without criterion", status: "measured" },
  blind: { group: "blind", label: "no help recorded this week", status: "measured" },
  beyond: { group: "horizon", label: "no evidence of contact", status: "measured" },
};

export const GROUPS: readonly Group[] = ["horizon", "blind", "discernment", "proximal", "alone"];

export const GROUP_LABEL: Readonly<Record<Group, string>> = {
  horizon: "beyond the horizon",
  blind: "blind band",
  discernment: "discernment",
  proximal: "proximal band",
  alone: "does alone",
};

export const HYPOTHESES: Readonly<Partial<Record<Group, string>>> = {
  horizon: "recognizable vs out of reach",
  proximal: "explains vs detects only",
  alone: "transfer vs known context",
};

export const BAND_ORDER: readonly Band[] = [
  "alone",
  "proximal",
  "unstable",
  "blindCovered",
  "blindBare",
  "blind",
  "beyond",
];

export interface Stratum {
  readonly band: Band;
  readonly from: number;
  readonly to: number;
}

const filled = (week: Week): week is Week & { independent: number; discernment: number; assisted: number } =>
  week.independent !== null && week.discernment !== null && week.assisted !== null;

const blindStrata = (week: Week, from: number, to: number): readonly Stratum[] => {
  const helps = week.blindCovered + week.blindBare;
  if (helps === 0) return [{ band: "blind", from, to }];
  const split = from + ((to - from) * week.blindCovered) / helps;
  return [
    { band: "blindCovered", from, to: split },
    { band: "blindBare", from: split, to },
  ];
};

export const strataOf = (week: Week, peak: number): readonly Stratum[] => {
  if (!filled(week)) return [];
  const low = Math.max(week.independent, week.discernment - (week.unstable ?? 0));
  const high = week.discernment;
  return [
    { band: "alone" as const, from: 0, to: week.independent },
    { band: "proximal" as const, from: week.independent, to: low },
    { band: "unstable" as const, from: low, to: high },
    ...blindStrata(week, high, week.assisted),
    { band: "beyond" as const, from: week.assisted, to: Math.max(peak, week.assisted) },
  ].filter((stratum) => stratum.to > stratum.from);
};

export const bandAt = (week: Week, level: number, peak: number): Band | undefined => {
  const strata = strataOf(week, peak);
  if (strata.length === 0) return undefined;
  return strata.find((stratum) => level >= stratum.from && level < stratum.to)?.band ?? strata.at(-1)?.band;
};

export const peakOf = (trajectory: DomainTrajectory): number =>
  Math.max(
    1,
    ...trajectory.weeks.map((week) => (week.assisted ?? 0) + 1),
    ...trajectory.weeks.map((week) => week.work ?? 0),
  );

export const markLevel = (week: Week): number | null => {
  if (week.work !== null) return week.work;
  if (week.discernment === null || week.assisted === null) return null;
  return (week.discernment + Math.max(week.assisted, week.discernment + 1)) / 2;
};

export const markIn = (marks: readonly Mark[], week: string): Mark | undefined => {
  const here = marks.filter((mark) => mark.week === week);
  return here.find((mark) => mark.kind === "ricochet") ?? here[0];
};

export const lastWeek = (trajectory: DomainTrajectory): Week | undefined =>
  [...trajectory.weeks].reverse().find((week) => filled(week));

export const landedIn = (trajectory: DomainTrajectory, week: Week): Band | undefined => {
  const level = week.work;
  return level === null ? undefined : bandAt(week, level, peakOf(trajectory));
};

export const describeBand = (band: Band): string =>
  band === "beyond" || band === "blind"
    ? GROUP_LABEL[BANDS[band].group]
    : `${GROUP_LABEL[BANDS[band].group]}, ${BANDS[band].label}`;
