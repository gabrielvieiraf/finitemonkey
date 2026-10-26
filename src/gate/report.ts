import { hasStale, latestFor } from "../evidence/ledger.js";
import type { Evidence, EvidenceStatus, Note, UnverifiedReason } from "../evidence/types.js";
import type { ContractSource } from "../task/load.js";
import type { TaskContract } from "../task/types.js";
import { REUSABLE_KINDS } from "./types.js";

export const GATE_SCHEMA = "finitemonkey/gate@1";

export type GateVerdict = "passed" | "failed" | "incomplete";

export interface ReportItem {
  readonly id: string;
  readonly kind: string;
  readonly status: EvidenceStatus;
  readonly notes: readonly Note[];
  readonly stale: boolean;
  readonly reason?: UnverifiedReason;
  readonly command?: string;
  readonly exitCode?: number | null;
  readonly durationMs?: number;
  readonly releasedBy?: string;
  readonly at?: string;
}

export interface GateReport {
  readonly schema: typeof GATE_SCHEMA;
  readonly task: string;
  readonly implicit: boolean;
  readonly goal: string;
  readonly treeHash: string;
  readonly base: string;
  readonly source: ContractSource;
  readonly contractEdited: boolean;
  readonly verdict: GateVerdict;
  readonly counts: { readonly passed: number; readonly failed: number; readonly unverified: number };
  readonly items: readonly ReportItem[];
  readonly decisionsNeeded: readonly string[];
  readonly fastPath: boolean;
}

const fromEvidence = (id: string, kind: string, entry: Evidence | undefined, stale: boolean): ReportItem => {
  if (entry === undefined) {
    return { id, kind, status: "unverified", reason: stale ? "no_evidence" : "no_evidence", notes: [], stale };
  }
  return {
    id,
    kind,
    status: entry.status,
    notes: entry.notes,
    stale: false,
    at: entry.at,
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    ...(entry.command === undefined ? {} : { command: entry.command }),
    ...(entry.exitCode === undefined ? {} : { exitCode: entry.exitCode }),
    ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }),
    ...(entry.releasedBy === undefined ? {} : { releasedBy: entry.releasedBy }),
  };
};

export const verdictOf = (items: readonly ReportItem[]): GateVerdict => {
  if (items.some((item) => item.status === "failed")) return "failed";
  return items.some((item) => item.status === "unverified") ? "incomplete" : "passed";
};

export interface ReportInput {
  readonly contract: TaskContract;
  readonly ledger: readonly Evidence[];
  readonly treeHash: string;
  readonly base: string;
  readonly source: ContractSource;
  readonly contractEdited: boolean;
  readonly fastPath: boolean;
}

export const buildReport = (input: ReportInput): GateReport => {
  const { contract, ledger, treeHash } = input;
  const items = contract.acceptance.map((check) => {
    const command = REUSABLE_KINDS.includes(check.kind) ? check.run : undefined;
    const entry = latestFor(
      ledger.filter((item) => item.task === contract.id),
      check.id,
      treeHash,
      command,
    );
    return fromEvidence(check.id, check.kind, entry, hasStale(ledger, check.id, treeHash));
  });
  const count = (status: EvidenceStatus): number => items.filter((item) => item.status === status).length;
  return {
    schema: GATE_SCHEMA,
    task: contract.id,
    implicit: contract.implicit,
    goal: contract.goal,
    treeHash,
    base: input.base,
    source: input.source,
    contractEdited: input.contractEdited,
    verdict: verdictOf(items),
    counts: { passed: count("passed"), failed: count("failed"), unverified: count("unverified") },
    items,
    decisionsNeeded: contract.decisionsNeeded,
    fastPath: input.fastPath,
  };
};
