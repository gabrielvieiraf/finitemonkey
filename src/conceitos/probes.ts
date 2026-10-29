import type { Domain } from "../perfil/types.js";
import { type ConceptId, domainOf } from "./concepts.js";
import type { ConceptEvent } from "./evidence.js";

export const PROBES_SCHEMA = "finitemonkey/probes@1";
export const PROBES_FEATURE = "probes";

export const PROBE_KINDS = ["predict", "variant", "what_if", "order", "relation", "clarify", "language"] as const;
export type ProbeKind = (typeof PROBE_KINDS)[number];
export type KeyRule = "observe" | "fails" | "passes" | "none";

export const KEY_RULE: Readonly<Record<ProbeKind, KeyRule>> = {
  predict: "observe",
  what_if: "observe",
  variant: "fails",
  order: "passes",
  relation: "passes",
  clarify: "passes",
  language: "none",
};

export const BUDGET = { perSession: 1, perWeek: 5, perDomainWeek: 2, sustainedDomainWeek: 3 } as const;
export const SKIPS_TO_PAUSE = 3;
export const SKIP_PAUSE_DAYS = 14;
export const CORRECT_TO_FADE = 2;
export const FADE_DAYS = 30;

export const GAP = {
  minValidProbes: 6,
  minTermRequests: 8,
  minDays: 14,
  wrongShare: 0.6,
  minConcepts: 2,
  minRelations: 2,
  quietDays: 60,
  halfLifeDays: 30,
} as const;

export type ProbeStatus = "open" | "right" | "wrong" | "answered" | "skipped" | "invalid";

export interface ProbeOption {
  readonly id: string;
  readonly text: string;
  readonly run?: string;
}

export interface Probe {
  readonly id: string;
  readonly kind: ProbeKind;
  readonly concept: ConceptId;
  readonly domain: Domain;
  readonly question: string;
  readonly why: string;
  readonly options: readonly ProbeOption[];
  readonly run?: string;
  readonly input?: string;
  readonly key: string | null;
  readonly status: ProbeStatus;
  readonly at: string;
  readonly session?: string;
  readonly presentedAt?: string;
  readonly answer?: string;
  readonly answeredAt?: string;
}

export interface Execution {
  readonly exitCode: number | null;
  readonly stdout: string;
}

export const answerKey = (
  kind: ProbeKind,
  options: readonly ProbeOption[],
  observed: Execution | undefined,
  perOption: ReadonlyMap<string, Execution>,
): string | null => {
  const rule = KEY_RULE[kind];
  if (rule === "none") return null;
  if (rule === "observe") {
    if (observed === undefined || observed.exitCode === null) return null;
    const out = observed.stdout.trim();
    const hits = options.filter((option) => option.text.trim() === out);
    return hits.length === 1 ? (hits[0]?.id ?? null) : null;
  }
  const wanted = (run: Execution | undefined): boolean => {
    const code = run?.exitCode ?? null;
    return code !== null && (rule === "fails" ? code !== 0 : code === 0);
  };
  const hits = options.filter((option) => wanted(perOption.get(option.id)));
  return hits.length === 1 && perOption.size === options.length ? (hits[0]?.id ?? null) : null;
};

export interface ProbeState {
  readonly probes: readonly Probe[];
  readonly skips: Readonly<Record<string, number>>;
  readonly pausedUntil: Readonly<Record<string, string>>;
}

export const EMPTY_STATE: ProbeState = { probes: [], skips: {}, pausedUntil: {} };

const DAY = 86_400_000;
const days = (from: string, to: number): number => (to - Date.parse(from)) / DAY;

const executable = (probe: Probe): boolean => probe.kind !== "language" && probe.kind !== "clarify";

export const asked = (probe: Probe): boolean => probe.status !== "invalid";

export const fadedUntil = (state: ProbeState, concept: ConceptId, events: readonly ConceptEvent[]): number => {
  const right = state.probes.filter(
    (probe) => probe.concept === concept && executable(probe) && probe.status === "right",
  );
  if (right.length < CORRECT_TO_FADE) return 0;
  const last = right.at(-1)?.answeredAt ?? right.at(-1)?.at ?? "";
  const reset = events.some(
    (event) =>
      event.concept === concept &&
      (event.kind === "failure_after_approval" || event.kind === "prediction_wrong") &&
      Date.parse(event.at) > Date.parse(last),
  );
  return reset ? 0 : Date.parse(last) + FADE_DAYS * DAY;
};

export interface BudgetCheck {
  readonly ok: boolean;
  readonly reason?: "session" | "week" | "domain" | "paused" | "faded";
}

export const budgetFor = (
  state: ProbeState,
  probe: Pick<Probe, "concept" | "domain">,
  session: string | undefined,
  now: number,
  events: readonly ConceptEvent[],
  sustained: ReadonlySet<Domain>,
): BudgetCheck => {
  const shown = state.probes.filter(
    (item): item is Probe & { readonly presentedAt: string } => item.presentedAt !== undefined,
  );
  const week = shown.filter((item) => days(item.presentedAt, now) < 7);
  if (session !== undefined && shown.filter((item) => item.session === session).length >= BUDGET.perSession)
    return { ok: false, reason: "session" };
  if (week.length >= BUDGET.perWeek) return { ok: false, reason: "week" };
  const limit = sustained.has(probe.domain) ? BUDGET.sustainedDomainWeek : BUDGET.perDomainWeek;
  if (week.filter((item) => item.domain === probe.domain).length >= limit) return { ok: false, reason: "domain" };
  const paused = state.pausedUntil[probe.domain];
  if (paused !== undefined && Date.parse(paused) > now) return { ok: false, reason: "paused" };
  if (fadedUntil(state, probe.concept, events) > now) return { ok: false, reason: "faded" };
  return { ok: true };
};

export const present = (state: ProbeState, id: string, session: string | undefined, at: string): ProbeState => ({
  ...state,
  probes: state.probes.map((item) =>
    item.id === id && item.presentedAt === undefined
      ? { ...item, presentedAt: at, ...(session === undefined ? {} : { session }) }
      : item,
  ),
});

export const settle = (state: ProbeState, id: string, answer: string | undefined, at: string): ProbeState => {
  const probe = state.probes.find((item) => item.id === id && item.status === "open");
  if (probe === undefined) return state;
  const status: ProbeStatus =
    answer === undefined ? "skipped" : probe.key === null ? "answered" : answer === probe.key ? "right" : "wrong";
  const skips = answer === undefined ? (state.skips[probe.domain] ?? 0) + 1 : 0;
  const pause =
    skips >= SKIPS_TO_PAUSE ? { [probe.domain]: new Date(Date.parse(at) + SKIP_PAUSE_DAYS * DAY).toISOString() } : {};
  return {
    probes: state.probes.map((item) =>
      item.id === id ? { ...item, status, answeredAt: at, ...(answer === undefined ? {} : { answer }) } : item,
    ),
    skips: { ...state.skips, [probe.domain]: skips >= SKIPS_TO_PAUSE ? 0 : skips },
    pausedUntil: { ...state.pausedUntil, ...pause },
  };
};

export type GapState = "no_data" | "coherent" | "watching" | "sustained";

export interface DomainGap {
  readonly domain: Domain;
  readonly state: GapState;
  readonly validProbes: number;
  readonly termRequests: number;
  readonly wrongConcepts: readonly ConceptId[];
  readonly confirmedRelations: number;
}

const decay = (at: string, now: number): number => 0.5 ** (Math.max(0, days(at, now)) / GAP.halfLifeDays);

export const gapOf = (domain: Domain, state: ProbeState, events: readonly ConceptEvent[], now: number): DomainGap => {
  const mine = state.probes.filter((probe) => probe.domain === domain);
  const valid = mine.filter((probe) => executable(probe) && (probe.status === "right" || probe.status === "wrong"));
  const terms = events.filter(
    (event) => event.kind === "exposure" && event.origin === "person" && domainOf(event.concept) === domain,
  );
  const first = [...valid.map((probe) => probe.at), ...terms.map((event) => event.at)].sort()[0];
  const base = {
    domain,
    validProbes: valid.length,
    termRequests: terms.length,
    wrongConcepts: [] as readonly ConceptId[],
    confirmedRelations: 0,
  };
  if (
    valid.length < GAP.minValidProbes ||
    terms.length < GAP.minTermRequests ||
    first === undefined ||
    days(first, now) < GAP.minDays
  )
    return { ...base, state: "no_data" };
  const cleared = new Set<ConceptId>([
    ...valid.filter((probe) => probe.status === "right").map((probe) => probe.concept),
    ...events.filter((event) => event.kind === "own_repair" && event.origin === "person").map((event) => event.concept),
  ]);
  const weight = (probe: Probe): number => decay(probe.answeredAt ?? probe.at, now);
  const wrongWeight = valid.filter((probe) => probe.status === "wrong").reduce((sum, probe) => sum + weight(probe), 0);
  const total = valid.reduce((sum, probe) => sum + weight(probe), 0);
  const wrongConcepts = [
    ...new Set(
      valid.filter((probe) => probe.status === "wrong" && !cleared.has(probe.concept)).map((probe) => probe.concept),
    ),
  ];
  const family = { ...base, wrongConcepts };
  const s = total > 0 && wrongWeight / total >= GAP.wrongShare && wrongConcepts.length >= GAP.minConcepts;
  if (!s) return { ...family, state: "coherent" };
  const confirmed = mine.filter(
    (probe) => probe.kind === "clarify" && probe.status === "wrong" && !cleared.has(probe.concept),
  ).length;
  const quiet = !events.some(
    (event) =>
      wrongConcepts.includes(event.concept) &&
      event.origin === "person" &&
      (event.kind === "own_repair" || event.kind === "own_change") &&
      days(event.at, now) < GAP.quietDays,
  );
  const sustained = confirmed >= GAP.minRelations && quiet;
  return { ...family, confirmedRelations: confirmed, state: sustained ? "sustained" : "watching" };
};
