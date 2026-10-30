import { type BandStep, conceptBand } from "./band.js";
import {
  claimBand,
  claimsIn,
  conceptsIn,
  type ConceptStatus,
  conceptStatus,
  resultsIn,
  supportStateOf,
} from "./claims.js";
import type { DomainView } from "./concepts.js";
import type { HorizonDomain, HorizonView } from "./horizon.js";
import type { NumberCheck } from "./numbers.js";
import type { ItemView } from "./research.js";
import {
  type Band,
  JUDGE_VERBS_SCHEMA,
  type JudgeClaimKind,
  type JudgeEntry,
  type JudgeExport,
  type ProbeForm,
  type ResultEntry,
  type SupportState,
} from "./types.js";

export const VERBS = [
  "observe",
  "classify",
  "verify",
  "ask",
  "handoff",
  "contest",
  "fade",
  "report",
  "export",
  "forget",
  "concept",
  "domain",
  "judge",
  "answer",
  "cut",
  "check",
  "anchor",
  "read",
  "promote",
  "horizon",
  "accept",
  "dismiss",
] as const;

export const ROW_ACTIONS = ["verify", "handoff", "cut", "judge"] as const;

export type RowAction = (typeof ROW_ACTIONS)[number];

export type Verb = (typeof VERBS)[number];

export interface RowConcept {
  readonly concept: string;
  readonly band: Band;
  readonly because?: string;
}

export interface XrayRow {
  readonly claim: string;
  readonly text: string;
  readonly kind: JudgeClaimKind;
  readonly state: SupportState;
  readonly band: Band;
  readonly concepts: readonly RowConcept[];
  readonly outcome?: string;
  readonly actions: readonly RowAction[];
}

export interface ProbeView {
  readonly probe: string;
  readonly claim: string;
  readonly form: ProbeForm;
  readonly prompt: string;
  readonly options: readonly string[];
  readonly answered: boolean;
  readonly correct?: boolean;
  readonly span?: string;
}

export interface ResultView {
  readonly result: string;
  readonly source: string;
  readonly total: number;
  readonly modelOnly: number;
  readonly done: boolean;
  readonly rows: readonly XrayRow[];
}

export interface ConceptView {
  readonly concept: string;
  readonly status: ConceptStatus;
  readonly label?: string;
  readonly domain?: string;
  readonly band: Band;
  readonly because?: BandStep;
  readonly positive: number;
  readonly negative: number;
  readonly exposures: number;
  readonly contested: readonly string[];
  readonly request: "withdrawn" | "active";
}

export interface ClaimView {
  readonly claim: string;
  readonly text: string;
  readonly state: SupportState;
  readonly outcome?: string;
  readonly proposed?: string;
  readonly numbers?: readonly NumberCheck[];
}

export interface ExceptionUse {
  readonly claim: string;
  readonly number: string;
}

export interface HandoffPackage {
  readonly claim: string;
  readonly text: string;
  readonly sources: readonly string[];
  readonly checked: readonly string[];
  readonly missing: string;
  readonly to: string;
  readonly at: string;
}

export interface AskView {
  readonly decision: string;
  readonly question: string;
  readonly criterion: string;
}

export interface JudgeResponse {
  readonly schema: typeof JUDGE_VERBS_SCHEMA;
  readonly verb: Verb;
  readonly ok: boolean;
  readonly reason?: string;
  readonly entry?: string;
  readonly result?: ResultView;
  readonly results?: readonly ResultView[];
  readonly concepts?: readonly ConceptView[];
  readonly domains?: readonly DomainView[];
  readonly claim?: ClaimView;
  readonly handoff?: HandoffPackage;
  readonly ask?: AskView;
  readonly export?: JudgeExport;
  readonly removed?: number;
  readonly probe?: ProbeView;
  readonly route?: "verify" | "handoff";
  readonly exceptions?: readonly ExceptionUse[];
  readonly item?: ItemView;
  readonly horizon?: readonly HorizonView[];
  readonly horizonDomains?: readonly HorizonDomain[];
}

export const response = (verb: Verb, fields: Omit<JudgeResponse, "schema" | "verb" | "ok"> = {}): JudgeResponse => ({
  schema: JUDGE_VERBS_SCHEMA,
  verb,
  ok: fields.reason === undefined,
  ...fields,
});

const ORDER: readonly (readonly [SupportState, Band])[] = [
  ["model-only", "beyond"],
  ["model-only", "no record"],
  ["model-only", "proximal"],
  ["model-only", "demonstrated"],
];

const STATE_RANK: Readonly<Record<SupportState, number>> = {
  "model-only": 0,
  "handed-off": 1,
  "person-judged": 2,
  "machine-verified": 3,
  retracted: 4,
};

const rankOf = (row: XrayRow): number => {
  const cell = ORDER.findIndex(([state, band]) => row.state === state && row.band === band);
  return cell >= 0 ? cell : ORDER.length + STATE_RANK[row.state];
};

export const orderRows = (rows: readonly XrayRow[]): readonly XrayRow[] =>
  rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => rankOf(left.row) - rankOf(right.row) || left.index - right.index)
    .map((item) => item.row);

const actionsFor = (state: SupportState): readonly RowAction[] => {
  if (state === "model-only") return ROW_ACTIONS;
  return state === "handed-off" ? ["verify", "cut"] : [];
};

export const rowOf = (claimId: string, entries: readonly JudgeEntry[], outcome?: string): XrayRow | undefined => {
  const claim = claimsIn(entries).find((item) => item.id === claimId);
  if (claim === undefined) return undefined;
  const band = claimBand(claim, entries);
  return {
    claim: claim.id,
    text: claim.text,
    kind: claim.kind,
    state: supportStateOf(claim.id, entries),
    band: band.band,
    concepts: band.concepts.map((item) => ({
      concept: item.concept,
      band: item.band,
      ...(item.because === undefined ? {} : { because: item.because.evidence }),
    })),
    ...(outcome === undefined ? {} : { outcome }),
    actions: actionsFor(supportStateOf(claim.id, entries)),
  };
};

export const resultView = (result: ResultEntry, entries: readonly JudgeEntry[]): ResultView => {
  const rows = orderRows(result.claims.flatMap((id) => rowOf(id, entries) ?? []));
  const modelOnly = rows.filter((row) => row.state === "model-only").length;
  return { result: result.id, source: result.source, total: rows.length, modelOnly, done: modelOnly === 0, rows };
};

const conceptIds = (entries: readonly JudgeEntry[]): readonly string[] => [
  ...new Set([
    ...conceptsIn(entries).map((concept) => concept.id),
    ...entries.flatMap((entry) => (entry.type === "evidence" ? entry.concepts : [])),
  ]),
];

export const conceptView = (id: string, entries: readonly JudgeEntry[]): ConceptView => {
  const concept = conceptsIn(entries).findLast((item) => item.id === id);
  const band = conceptBand(id, entries);
  return {
    concept: id,
    status: concept === undefined ? "active" : conceptStatus(concept, entries),
    ...(concept === undefined ? {} : { label: concept.label, domain: concept.domain }),
    band: band.band,
    ...(band.because === undefined ? {} : { because: band.because }),
    positive: band.positive,
    negative: band.negative,
    exposures: band.exposures,
    contested: band.contested,
    request: band.band === "demonstrated" ? "withdrawn" : "active",
  };
};

export const conceptViews = (entries: readonly JudgeEntry[], only?: readonly string[]): readonly ConceptView[] =>
  (only ?? conceptIds(entries)).map((id) => conceptView(id, entries));

export const resultViews = (entries: readonly JudgeEntry[]): readonly ResultView[] =>
  resultsIn(entries).map((result) => resultView(result, entries));

export const exceptionUses = (entries: readonly JudgeEntry[]): readonly ExceptionUse[] => {
  const latest = new Map<string, readonly string[]>();
  for (const entry of entries)
    if (entry.type === "support" && entry.outcome !== undefined) latest.set(entry.claim, entry.exceptions ?? []);
  return [...latest].flatMap(([claim, numbers]) => numbers.map((number) => ({ claim, number })));
};
