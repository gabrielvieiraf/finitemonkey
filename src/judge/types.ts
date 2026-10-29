export const JUDGE_SCHEMA = "finitemonkey/judge@1";
export const JUDGE_VERBS_SCHEMA = "finitemonkey/judge-verbs@1";
export const JUDGE_FEATURE = "judge-core";
export const JUDGE_FILE = "judge.jsonl";
export const DEMONSTRATED_AFTER = 3;

export const BANDS = ["demonstrated", "proximal", "beyond", "no record"] as const;
export const SUPPORT_STATES = ["machine-verified", "person-judged", "model-only", "handed-off", "retracted"] as const;
export const CLAIM_KINDS = ["check", "source-span", "number", "prose"] as const;
export const PROOF_KINDS = [
  "prediction",
  "probe",
  "own-change",
  "person-repair",
  "source-check",
  "failure-after-acceptance",
  "exposure",
] as const;
export const RESULTS = ["pass", "fail"] as const;
export const ORIGINS = ["person", "agent", "tool"] as const;
export const CONCEPT_ORIGINS = ["detector", "span", "model"] as const;
export const DECIDERS = ["machine", "person"] as const;
export const CRITERION_KINDS = ["source-span", "example", "check", "none"] as const;
export const HORIZON_KINDS = ["question", "concept", "scope"] as const;
export const HORIZON_STATES = ["shown", "accepted", "dismissed"] as const;
export const ANCHOR_KINDS = ["span", "code", "compute"] as const;
export const EVENT_CAUSES = ["contradicted", "retracted", "failed-in-use"] as const;
export const EVENT_STATES = ["open", "pending", "held"] as const;
export const ENTRY_TYPES = [
  "domain",
  "concept",
  "evidence",
  "contest",
  "claim",
  "support",
  "result",
  "horizon",
  "signal",
  "event",
  "item",
  "ask",
  "probe",
] as const;
export const PROBE_FORMS = ["two-spans", "unsupported-claim", "predict-number"] as const;

export type Band = (typeof BANDS)[number];
export type SupportState = (typeof SUPPORT_STATES)[number];
export type JudgeClaimKind = (typeof CLAIM_KINDS)[number];
export type ProofKind = (typeof PROOF_KINDS)[number];
export type ProofResult = (typeof RESULTS)[number];
export type EvidenceOrigin = (typeof ORIGINS)[number];
export type ConceptOrigin = (typeof CONCEPT_ORIGINS)[number];
export type Decider = (typeof DECIDERS)[number];
export type CriterionKind = (typeof CRITERION_KINDS)[number];
export type HorizonKind = (typeof HORIZON_KINDS)[number];
export type HorizonState = (typeof HORIZON_STATES)[number];
export type AnchorKind = (typeof ANCHOR_KINDS)[number];
export type EventCause = (typeof EVENT_CAUSES)[number];
export type EventState = (typeof EVENT_STATES)[number];
export type EntryType = (typeof ENTRY_TYPES)[number];
export type ProbeForm = (typeof PROBE_FORMS)[number];

export interface JudgeAnchor {
  readonly kind: AnchorKind;
  readonly ref: string;
  readonly hash: string;
  readonly span?: string;
  readonly inputs?: readonly string[];
}

interface EntryBase {
  readonly id: string;
  readonly at: string;
}

export interface DomainEntry extends EntryBase {
  readonly type: "domain";
  readonly parent?: string;
}

export interface ConceptEntry extends EntryBase {
  readonly type: "concept";
  readonly domain: string;
  readonly label: string;
  readonly synonyms: readonly string[];
  readonly anchors: readonly JudgeAnchor[];
  readonly origin: ConceptOrigin;
}

export interface EvidenceEntry extends EntryBase {
  readonly type: "evidence";
  readonly concepts: readonly string[];
  readonly proof: ProofKind;
  readonly result: ProofResult;
  readonly ref: string;
  readonly origin: EvidenceOrigin;
  readonly claim?: string;
}

export interface ContestEntry extends EntryBase {
  readonly type: "contest";
  readonly target: string;
  readonly reason?: string;
}

export interface ClaimEntry extends EntryBase {
  readonly type: "claim";
  readonly text: string;
  readonly kind: JudgeClaimKind;
  readonly concepts: readonly string[];
  readonly anchors: readonly JudgeAnchor[];
  readonly provenance: string;
  readonly because?: readonly string[];
}

export interface SupportEntry extends EntryBase {
  readonly type: "support";
  readonly claim: string;
  readonly state: SupportState;
  readonly by: Decider;
  readonly ref?: string;
  readonly outcome?: string;
  readonly to?: string;
  readonly missing?: string;
  readonly bands?: Readonly<Record<string, Band>>;
  readonly anchors?: readonly JudgeAnchor[];
}

export interface ResultEntry extends EntryBase {
  readonly type: "result";
  readonly source: string;
  readonly hash: string;
  readonly claims: readonly string[];
  readonly domain?: string;
  readonly task?: string;
  readonly research?: string;
  readonly decision?: string;
}

export interface HorizonEntry extends EntryBase {
  readonly type: "horizon";
  readonly kind: HorizonKind;
  readonly text: string;
  readonly criterion: CriterionKind;
  readonly answer?: string;
  readonly domain: string;
  readonly state: HorizonState;
  readonly task?: string;
}

export interface SignalEntry extends EntryBase {
  readonly type: "signal";
  readonly family: string;
  readonly confidence: number;
  readonly state: "shadow";
  readonly ref?: string;
}

export interface EventEntry extends EntryBase {
  readonly type: "event";
  readonly claim: string;
  readonly cause: EventCause;
  readonly state: EventState;
  readonly support: SupportState;
  readonly bands: Readonly<Record<string, Band>>;
  readonly sources: readonly string[];
  readonly fixedBy?: string;
}

export interface ItemEntry extends EntryBase {
  readonly type: "item";
  readonly origin: string;
  readonly hash: string;
  readonly instructions: number;
  readonly synthesis: boolean;
}

export interface AskEntry extends EntryBase {
  readonly type: "ask";
  readonly task: string;
  readonly decision: string;
  readonly question: string;
  readonly criterion: string;
}

export interface ProbeEntry extends EntryBase {
  readonly type: "probe";
  readonly claim: string;
  readonly concepts: readonly string[];
  readonly form: ProbeForm;
  readonly prompt: string;
  readonly options: readonly string[];
  readonly key: number;
  readonly keyHash: string;
  readonly decision?: string;
  readonly task?: string;
}

export type JudgeEntry =
  | DomainEntry
  | ConceptEntry
  | EvidenceEntry
  | ContestEntry
  | ClaimEntry
  | SupportEntry
  | ResultEntry
  | HorizonEntry
  | SignalEntry
  | EventEntry
  | ItemEntry
  | AskEntry
  | ProbeEntry;

export interface JudgeExport {
  readonly schema: typeof JUDGE_SCHEMA;
  readonly domains: readonly DomainEntry[];
  readonly concepts: readonly ConceptEntry[];
  readonly evidence: readonly EvidenceEntry[];
  readonly contests: readonly ContestEntry[];
  readonly claims: readonly ClaimEntry[];
  readonly support: readonly SupportEntry[];
  readonly results: readonly ResultEntry[];
  readonly horizon: readonly HorizonEntry[];
  readonly signals: readonly SignalEntry[];
  readonly events: readonly EventEntry[];
  readonly items: readonly ItemEntry[];
  readonly asks: readonly AskEntry[];
  readonly probes: readonly ProbeEntry[];
}

export const oneOf = <T extends string>(options: readonly T[], value: unknown): T | undefined =>
  options.find((option) => option === value);
