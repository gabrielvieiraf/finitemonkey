import type { Dataset, FeatureCount, ParticipantRecord, SessionRecord } from "./bench-people-data.js";
import { type Arm, ARMS, type Profile, PROFILES, type Slot } from "./bench-people-plan.js";
import { average, median, type PairedEstimate, pairedInterval, signFlipP } from "./bench-people-stats.js";

export const COMPLETION_FLOOR = -0.25;
export const WALL_CEILING = 1.2;
export const MIN_SHOWN = 5;
export const MAX_DISMISSAL = 0.1;

export interface ArmTotals {
  readonly arm: Arm;
  readonly sessions: number;
  readonly claimedDone: number;
  readonly oracleGreen: number;
  readonly falseDone: number;
  readonly trapGreen: number;
  readonly trapTotal: number;
  readonly medianWallMinutes: number;
  readonly tokens: number;
  readonly tokenSessions: number;
}

export interface BeliefRow {
  readonly participant: string;
  readonly perceived: number | null;
  readonly measured: number;
}

export interface FeatureRow {
  readonly feature: string;
  readonly sessions: number;
  readonly shown: number;
  readonly dismissed: number;
  readonly verdict: string;
}

export interface Analysis {
  readonly synthetic: boolean;
  readonly enrolled: readonly ParticipantRecord[];
  readonly analysed: readonly string[];
  readonly incomplete: readonly string[];
  readonly totals: readonly ArmTotals[];
  readonly byProfile: readonly { readonly profile: Profile; readonly totals: readonly ArmTotals[] }[];
  readonly primary: PairedEstimate | undefined;
  readonly primaryP: number | undefined;
  readonly completion: PairedEstimate | undefined;
  readonly logWall: PairedEstimate | undefined;
  readonly belief: readonly BeliefRow[];
  readonly features: readonly FeatureRow[];
  readonly deviations: readonly SessionRecord[];
  readonly missing: readonly string[];
  readonly sessions: readonly SessionRecord[];
}

const falseDone = (session: SessionRecord): boolean => session.claimedDone && !session.oracleGreen;

const count = (sessions: readonly SessionRecord[], test: (session: SessionRecord) => boolean): number =>
  sessions.filter(test).length;

export const armTotals = (sessions: readonly SessionRecord[], arm: Arm): ArmTotals => {
  const mine = sessions.filter((session) => session.assigned === arm);
  const traps = mine.filter((session) => session.trapGreen !== null);
  const tokens = mine.flatMap((session) => (session.tokens === null ? [] : [session.tokens]));
  return {
    arm,
    sessions: mine.length,
    claimedDone: count(mine, (session) => session.claimedDone),
    oracleGreen: count(mine, (session) => session.oracleGreen),
    falseDone: count(mine, falseDone),
    trapGreen: count(traps, (session) => session.trapGreen === true),
    trapTotal: traps.length,
    medianWallMinutes: median(mine.map((session) => session.wallSeconds / 60)),
    tokens: tokens.reduce((sum, value) => sum + value, 0),
    tokenSessions: tokens.length,
  };
};

const rate = (sessions: readonly SessionRecord[], test: (session: SessionRecord) => boolean): number =>
  count(sessions, test) / sessions.length;

const meanLogWall = (sessions: readonly SessionRecord[]): number =>
  average(sessions.map((session) => Math.log(session.wallSeconds)));

const differences = (
  people: readonly (readonly SessionRecord[])[],
  measure: (sessions: readonly SessionRecord[]) => number,
): readonly number[] =>
  people.map((sessions) => {
    const fm = sessions.filter((session) => session.assigned === "fm");
    const plain = sessions.filter((session) => session.assigned === "plain");
    return measure(fm) - measure(plain);
  });

const featureVerdict = (shown: number, dismissed: number): string => {
  if (shown < MIN_SHOWN) return "too few showings to judge";
  return dismissed / shown > MAX_DISMISSAL ? "drop from default: dismissed over 10%" : "kept on this measure";
};

export const featureRows = (sessions: readonly SessionRecord[]): readonly FeatureRow[] => {
  const ids = [...new Set(sessions.flatMap((session) => Object.keys(session.features)))].sort();
  return ids.map((feature) => {
    const counts = sessions.flatMap((session) => {
      const found: FeatureCount | undefined = session.features[feature];
      return found === undefined ? [] : [found];
    });
    const shown = counts.reduce((sum, item) => sum + item.shown, 0);
    const dismissed = counts.reduce((sum, item) => sum + item.dismissed, 0);
    return {
      feature,
      sessions: counts.filter((item) => item.shown > 0).length,
      shown,
      dismissed,
      verdict: featureVerdict(shown, dismissed),
    };
  });
};

const missingSessions = (
  slots: readonly Slot[],
  enrolled: readonly ParticipantRecord[],
  sessions: readonly SessionRecord[],
) =>
  enrolled
    .filter((person) => !person.withdrawn)
    .flatMap((person) => {
      const slot = slots.find((item) => item.id === person.participant);
      return (slot?.sessions ?? [])
        .filter((planned) => !sessions.some((s) => s.participant === person.participant && s.task === planned.task))
        .map((planned) => `${person.participant}/${planned.task}`);
    });

export const analyse = (dataset: Dataset, slots: readonly Slot[]): Analysis => {
  const active = dataset.participants.filter((person) => !person.withdrawn);
  const sessionsOf = (participant: string) => dataset.sessions.filter((session) => session.participant === participant);
  const hasBoth = (participant: string) => ARMS.every((arm) => sessionsOf(participant).some((s) => s.assigned === arm));
  const analysed = active.map((person) => person.participant).filter(hasBoth);
  const people = analysed.map(sessionsOf);
  const included = people.flat();
  const primaryDiffs = differences(people, (sessions) => rate(sessions, falseDone));
  const logWallDiffs = differences(people, meanLogWall);
  return {
    synthetic: dataset.synthetic,
    enrolled: dataset.participants,
    analysed,
    incomplete: active.map((person) => person.participant).filter((id) => !hasBoth(id)),
    totals: ARMS.map((arm) => armTotals(included, arm)),
    byProfile: PROFILES.map((profile) => {
      const ids = new Set(active.filter((person) => person.profile === profile).map((person) => person.participant));
      const mine = included.filter((session) => ids.has(session.participant));
      return { profile, totals: ARMS.map((arm) => armTotals(mine, arm)) };
    }),
    primary: pairedInterval(primaryDiffs),
    primaryP: signFlipP(primaryDiffs),
    completion: pairedInterval(differences(people, (sessions) => rate(sessions, (session) => session.oracleGreen))),
    logWall: pairedInterval(logWallDiffs),
    belief: analysed.map((participant, index) => ({
      participant,
      perceived: active.find((person) => person.participant === participant)?.perceivedSpeedupPercent ?? null,
      measured: (1 - Math.exp(logWallDiffs[index] ?? Number.NaN)) * 100,
    })),
    features: featureRows(included.filter((session) => session.assigned === "fm")),
    deviations: dataset.sessions.filter((session) => session.ran !== session.assigned),
    missing: missingSessions(slots, dataset.participants, dataset.sessions),
    sessions: dataset.sessions,
  };
};

export const primaryVerdict = (primary: PairedEstimate | undefined): string => {
  if (primary === undefined) return "not enough participants: needs at least 2 with sessions in both arms";
  if (primary.high < 0) return "Finite Monkey lowered false done";
  if (primary.low > 0) return "Finite Monkey raised false done";
  return "not shown: the 95% interval includes zero";
};

export const guardrails = (
  analysis: Analysis,
): readonly { readonly name: string; readonly breached: boolean | undefined }[] => [
  {
    name: "completion not lower by more than 0.25",
    breached: analysis.completion === undefined ? undefined : analysis.completion.estimate < COMPLETION_FLOOR,
  },
  {
    name: "wall time not up by more than 20%",
    breached: analysis.logWall === undefined ? undefined : Math.exp(analysis.logWall.estimate) > WALL_CEILING,
  },
];

export const bundleDecision = (analysis: Analysis): string => {
  const rails = guardrails(analysis);
  if (analysis.primary === undefined || rails.some((rail) => rail.breached === undefined))
    return "no decision: not enough data";
  if (rails.some((rail) => rail.breached === true)) return "do not claim a benefit: a guardrail was breached";
  return analysis.primary.high < 0
    ? "claim the benefit, with this n and these counts"
    : "do not claim a benefit: not shown";
};
