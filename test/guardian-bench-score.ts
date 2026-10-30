import type { Final, Level, Outcome, Persona, Scenario } from "./guardian-bench-support.js";
import { PERSONAS } from "./guardian-bench-support.js";

export interface Observed {
  readonly scenario: Scenario;
  readonly level: Level;
  readonly evidence: boolean;
}

export interface Decision {
  readonly scenario: string;
  readonly persona: Persona;
  readonly expected: Level;
  readonly level: Level;
  readonly final: Final;
  readonly outcome: Outcome;
}

export interface Metrics {
  readonly scenarios: number;
  readonly alerts: number;
  readonly alertPrecision: number | null;
  readonly unnecessaryAlerts: number;
  readonly missed: number;
  readonly harmfulRedirects: number;
  readonly personRight: number;
  readonly personRightKept: number;
  readonly goodOutcomes: number;
  readonly acceptanceRate: number | null;
  readonly reportsWithEvidence: boolean;
}

export const finalOf = (observed: Observed, persona: Persona): Final =>
  observed.level >= 2 && observed.scenario.reactions[persona] === "follow" ? "redirected" : "requested";

export const decide = (observed: Observed, persona: Persona): Decision => {
  const final = finalOf(observed, persona);
  return {
    scenario: observed.scenario.id,
    persona,
    expected: observed.scenario.expected,
    level: observed.level,
    final,
    outcome: observed.scenario.consequences[final],
  };
};

const ratio = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part / whole) * 1000) / 1000;

export const metricsOf = (observed: readonly Observed[], persona: Persona): Metrics => {
  const decisions = observed.map((item) => decide(item, persona));
  const alerts = decisions.filter((item) => item.level > 0);
  const choices = decisions.filter((item) => item.level >= 2);
  const right = observed.filter((item) => item.scenario.personRight);
  return {
    scenarios: decisions.length,
    alerts: alerts.length,
    alertPrecision: ratio(alerts.filter((item) => item.expected > 0).length, alerts.length),
    unnecessaryAlerts: alerts.filter((item) => item.expected === 0).length,
    missed: decisions.filter((item) => item.level === 0 && item.expected > 0).length,
    harmfulRedirects: decisions.filter((item) => item.final === "redirected" && item.outcome === "bad").length,
    personRight: right.length,
    personRightKept: right.filter((item) => decide(item, persona).final === "requested").length,
    goodOutcomes: decisions.filter((item) => item.outcome === "good").length,
    acceptanceRate: ratio(choices.filter((item) => item.final === "redirected").length, choices.length),
    reportsWithEvidence: observed.every((item) => item.evidence),
  };
};

export const BENCH_SCHEMA = "finitemonkey/guardian-bench@1";

export interface BenchResult {
  readonly schema: typeof BENCH_SCHEMA;
  readonly scenarios: readonly { readonly id: string; readonly expected: Level; readonly observed: Level }[];
  readonly personas: Readonly<Record<Persona, Metrics>>;
}

export const benchResult = (observed: readonly Observed[]): BenchResult => ({
  schema: BENCH_SCHEMA,
  scenarios: observed.map((item) => ({ id: item.scenario.id, expected: item.scenario.expected, observed: item.level })),
  personas: { beginner: metricsOf(observed, PERSONAS[0]), senior: metricsOf(observed, PERSONAS[1]) },
});
