import type { Params } from "../i18n/translate.js";

export const EVIDENCE_SCHEMA = "finitemonkey/evidence@1";

export const EVIDENCE_STATUSES = ["passed", "failed", "unverified"] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const UNVERIFIED_REASONS = [
  "tool_missing",
  "timeout",
  "rate_limited",
  "budget",
  "not_implemented",
  "no_gh",
  "network",
  "pending",
  "untrusted",
  "rewriter",
  "awaiting_person",
  "no_evidence",
  "no_baseline",
  "needs_approval",
  "masked_exit",
  "no_test_count",
  "no_verdict",
] as const;

export type UnverifiedReason = (typeof UNVERIFIED_REASONS)[number];

export const COMPLETION_STATES = [
  "unverified",
  "running",
  "verified",
  "partial",
  "invalidated",
  "blocked",
  "failed",
  "inconclusive",
  "needs_approval",
] as const;

export type CompletionState = (typeof COMPLETION_STATES)[number];

export interface Note {
  readonly key: string;
  readonly params: Params;
}

export interface EvidenceInputs {
  readonly cwd: string;
  readonly lockfiles: Readonly<Record<string, string>>;
  readonly tools: Readonly<Record<string, string>>;
  readonly env: Readonly<Record<string, string>>;
}

export interface Evidence {
  readonly schema: typeof EVIDENCE_SCHEMA;
  readonly task: string;
  readonly check: string;
  readonly kind: string;
  readonly status: EvidenceStatus;
  readonly treeHash: string;
  readonly at: string;
  readonly notes: readonly Note[];
  readonly command?: string;
  readonly exitCode?: number | null;
  readonly stdoutSha256?: string;
  readonly durationMs?: number;
  readonly reason?: UnverifiedReason;
  readonly releasedBy?: string;
  readonly failures?: readonly string[];
  readonly testCount?: number;
  readonly state?: CompletionState;
  readonly from?: CompletionState;
  readonly stateReason?: string;
  readonly inputs?: EvidenceInputs;
  readonly scripts?: string;
}

export const GATE_CHECK = "*gate*";
