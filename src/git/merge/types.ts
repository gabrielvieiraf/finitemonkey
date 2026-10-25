export type Side = "ours" | "theirs";

export type FileStatus = "added" | "deleted" | "modified" | "renamed" | "copied";

export interface Hunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly removed: readonly string[];
  readonly added: readonly string[];
}

export interface FileDiff {
  readonly oldPath: string | undefined;
  readonly newPath: string | undefined;
  readonly status: FileStatus;
  readonly binary: boolean;
  readonly hunks: readonly Hunk[];
}

export type FindingKind =
  | "missing-addition"
  | "removal-not-honored"
  | "count"
  | "missing-file"
  | "missing-symbol"
  | "binary"
  | "generated-differs"
  | "invalid-dropped";

export interface Finding {
  readonly kind: FindingKind;
  readonly file: string;
  readonly side: Side | undefined;
  readonly line: number | undefined;
  readonly text: string;
  readonly weak: boolean;
  readonly expected?: number;
  readonly actual?: number;
}

export interface MergeInputs {
  readonly base: string;
  readonly ours: string;
  readonly theirs: string;
  readonly result: string;
  readonly resultLabel: string;
  readonly bases: number;
}

export const DROPPED_REASONS = [
  "mesma_intencao_outro_lado",
  "revertido_de_proposito",
  "regenerado",
  "movido_para",
  "decisao_humana",
] as const;

export type DroppedReason = (typeof DROPPED_REASONS)[number];

export interface DroppedItem {
  readonly file: string;
  readonly side: Side | undefined;
  readonly text: string | undefined;
  readonly reason: string;
  readonly approvedBy: string | undefined;
}
