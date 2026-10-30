import { bandSnapshot, claimsIn, supportStateOf } from "./claims.js";
import type { Band, ClaimEntry, EventEntry, JudgeEntry, SupportState } from "./types.js";

export const EVENTS_FEATURE = "ricochet-events";

export type ContradictionProposer = (
  claim: string,
) => readonly { readonly source: string; readonly span: string }[] | undefined;

export interface Snapshot {
  readonly support: SupportState;
  readonly bands: Readonly<Record<string, Band>>;
}

export const acceptedAt = (claim: ClaimEntry, entries: readonly JudgeEntry[]): string =>
  entries.findLast((entry) => entry.type === "support" && entry.claim === claim.id)?.at ?? claim.at;

export const snapshotAt = (claim: ClaimEntry, entries: readonly JudgeEntry[]): Snapshot => {
  const at = acceptedAt(claim, entries);
  const before = entries.filter((entry) => entry.at <= at);
  return { support: supportStateOf(claim.id, before), bands: bandSnapshot(claim, before) };
};

export const dependentsOf = (claim: string, entries: readonly JudgeEntry[]): readonly ClaimEntry[] => {
  const claims = claimsIn(entries);
  const found = new Map<string, ClaimEntry>();
  const walk = (id: string): void => {
    for (const next of claims.filter((item) => (item.because ?? []).includes(id) && !found.has(item.id))) {
      found.set(next.id, next);
      walk(next.id);
    }
  };
  walk(claim);
  return [...found.values()];
};

export const eventsIn = (entries: readonly JudgeEntry[]): readonly EventEntry[] => {
  const latest = new Map<string, EventEntry>();
  for (const entry of entries) if (entry.type === "event") latest.set(entry.id, entry);
  return [...latest.values()];
};

export const claimSources = (claim: ClaimEntry, entries: readonly JudgeEntry[]): readonly string[] => [
  ...new Set([
    ...claim.anchors.map((anchor) => anchor.ref),
    ...entries.flatMap((entry) =>
      entry.type === "support" && entry.claim === claim.id ? (entry.anchors ?? []).map((anchor) => anchor.ref) : [],
    ),
  ]),
];
