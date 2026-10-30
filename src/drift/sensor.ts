import { classOf, majority, type SessionStats } from "./collect.js";

export const DRIFT_SCHEMA = "finitemonkey/drift@1";
export const INDICATORS = ["readsPerEdit", "wholeFileShare", "correctionsPerSession"] as const;
export const BASELINE_DAYS = 14;
export const MIN_BASELINE = 3;
export const PERSIST_DAYS = 3;
export const MIN_MUTATIONS = 5;
export const BAND = 0.35;

export type Indicator = (typeof INDICATORS)[number];
export type TaskClass = "small" | "large";

export interface DayPoint {
  readonly day: string;
  readonly taskClass: TaskClass;
  readonly sessions: number;
  readonly mutations: number;
  readonly model: string;
  readonly version: string;
  readonly values: Readonly<Record<Indicator, number>>;
}

export interface DriftWarning {
  readonly indicator: Indicator;
  readonly taskClass: TaskClass;
  readonly since: string;
  readonly baseline: number;
  readonly current: number;
  readonly changes: readonly string[];
}

export interface DriftReport {
  readonly schema: typeof DRIFT_SCHEMA;
  readonly days: readonly DayPoint[];
  readonly warnings: readonly DriftWarning[];
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

const pointOf = (day: string, taskClass: TaskClass, sessions: readonly SessionStats[]): DayPoint => {
  const sum = (pick: (item: SessionStats) => number): number => sessions.reduce((total, item) => total + pick(item), 0);
  const mutations = sum((item) => item.edits + item.writes);
  const tally = (pick: (item: SessionStats) => string): string =>
    majority(
      sessions.reduce(
        (counts, item) => counts.set(pick(item), (counts.get(pick(item)) ?? 0) + 1),
        new Map<string, number>(),
      ),
    );
  return {
    day,
    taskClass,
    sessions: sessions.length,
    mutations,
    model: tally((item) => item.model),
    version: tally((item) => item.version),
    values: {
      readsPerEdit: round(sum((item) => item.reads) / Math.max(1, mutations)),
      wholeFileShare: round(sum((item) => item.writes) / Math.max(1, mutations)),
      correctionsPerSession: round(sum((item) => item.corrections) / Math.max(1, sessions.length)),
    },
  };
};

export const dayPoints = (sessions: readonly SessionStats[]): readonly DayPoint[] => {
  const groups = new Map<string, SessionStats[]>();
  for (const item of sessions) {
    const key = `${item.day}\u0000${classOf(item)}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()]
    .map(([key, items]) => {
      const [day = "", taskClass = "small"] = key.split("\u0000");
      return pointOf(day, taskClass === "large" ? "large" : "small", items);
    })
    .sort((a, b) => a.day.localeCompare(b.day) || a.taskClass.localeCompare(b.taskClass));
};

const mean = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

export const BAND_FLOOR = 0.05;

const outOfBand = (value: number, baseline: number): boolean =>
  Math.abs(value - baseline) > Math.max(BAND * baseline, BAND_FLOOR);

const changesBetween = (before: readonly DayPoint[], after: readonly DayPoint[]): readonly string[] => {
  const top = (points: readonly DayPoint[], pick: (point: DayPoint) => string): string =>
    majority(
      points.reduce(
        (counts, point) => counts.set(pick(point), (counts.get(pick(point)) ?? 0) + 1),
        new Map<string, number>(),
      ),
    );
  return (
    [
      ["model", (point: DayPoint) => point.model],
      ["version", (point: DayPoint) => point.version],
    ] as const
  ).flatMap(([name, pick]) => {
    const from = top(before, pick);
    const to = top(after, pick);
    return from === to ? [] : [`${name} ${from} -> ${to}`];
  });
};

const warningsFor = (points: readonly DayPoint[], indicator: Indicator): readonly DriftWarning[] => {
  const warnings: DriftWarning[] = [];
  const normal: DayPoint[] = [];
  let streak: DayPoint[] = [];
  for (const point of points) {
    const window = normal.slice(-BASELINE_DAYS);
    const baseline = mean(window.map((item) => item.values[indicator]));
    if (window.length >= MIN_BASELINE && outOfBand(point.values[indicator], baseline)) {
      streak = [...streak, point];
      if (streak.length === PERSIST_DAYS) {
        warnings.push({
          indicator,
          taskClass: point.taskClass,
          since: streak[0]?.day ?? point.day,
          baseline: round(baseline),
          current: round(mean(streak.map((item) => item.values[indicator]))),
          changes: changesBetween(window, streak),
        });
      }
      continue;
    }
    normal.push(...streak, point);
    streak = [];
  }
  return warnings;
};

export const driftReport = (sessions: readonly SessionStats[]): DriftReport => {
  const days = dayPoints(sessions);
  const warnings = (["small", "large"] as const).flatMap((taskClass) => {
    const points = days.filter((point) => point.taskClass === taskClass && point.mutations >= MIN_MUTATIONS);
    return INDICATORS.flatMap((indicator) => warningsFor(points, indicator));
  });
  return { schema: DRIFT_SCHEMA, days, warnings };
};
