import { claimsIn } from "./claims.js";
import { rowOf, type XrayRow } from "./response.js";
import { normalizeSpan } from "./span.js";
import type { JudgeEntry } from "./types.js";

export const TRIAGE_FEATURE = "triage";
export const TRIAGE_FLAGS_PER_TASK = 3;
export const TRIAGE_CLAIMS_PER_FLAG = 5;
export const DOCUMENT = /\.(?:md|mdx|markdown|txt|rst|adoc)$/i;

export const needsTriage = (row: XrayRow): boolean =>
  row.state === "model-only" && (row.band === "beyond" || row.band === "no record");

export const triageRows = (entries: readonly JudgeEntry[], text: string): readonly XrayRow[] => {
  const written = normalizeSpan(text);
  return claimsIn(entries).flatMap((claim) => {
    if (!written.includes(normalizeSpan(claim.text))) return [];
    const row = rowOf(claim.id, entries);
    return row !== undefined && needsTriage(row) ? [row] : [];
  });
};

export interface TaskFlags {
  readonly claims: readonly string[];
  readonly flags: number;
}

export const flagsFor = (entries: readonly JudgeEntry[], task: string): TaskFlags => {
  const refs = entries.flatMap((entry) =>
    entry.type === "signal" && entry.family === "triage-flag" && entry.ref?.startsWith(`${task}\u0000`) === true
      ? [entry.ref.split("\u0000")]
      : [],
  );
  return {
    claims: refs.map((parts) => parts[2] ?? ""),
    flags: new Set(refs.map((parts) => parts[1] ?? "")).size,
  };
};
