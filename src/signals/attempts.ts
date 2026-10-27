import type { SignalEntry } from "./store.js";

export interface PendingAttempt {
  readonly sig: string;
  readonly failed: number;
  readonly sample: string;
}

export interface FourthOutcomes {
  readonly fired: number;
  readonly solved: number;
}

const clears = (entry: SignalEntry, sig: string): boolean =>
  entry.kind === "research" || (entry.kind === "release" && entry.sig === sig);

export const pendingAttempt = (entries: readonly SignalEntry[], threshold: number): PendingAttempt | undefined => {
  const last = entries.findLast((entry) => entry.kind === "error");
  if (last?.kind !== "error") return undefined;
  const cleared = entries.findLastIndex((entry) => clears(entry, last.sig));
  const failed = entries.slice(cleared + 1).filter((entry) => entry.kind === "error" && entry.sig === last.sig).length;
  return failed >= threshold ? { sig: last.sig, failed, sample: last.sample } : undefined;
};

const solvedAfter = (entries: readonly SignalEntry[], index: number, sig: string): boolean => {
  const rest = entries.slice(index + 1);
  const returned = rest.some((entry) => entry.kind === "error" && entry.sig === sig);
  const settled = rest.some((entry) => entry.kind === "prompt" || entry.kind === "error");
  return settled && !returned;
};

export const fourthOutcomes = (entries: readonly SignalEntry[]): FourthOutcomes => {
  const fired = entries.flatMap((entry, index) => (entry.kind === "fourth" ? [{ sig: entry.sig, index }] : []));
  return {
    fired: fired.length,
    solved: fired.filter(({ sig, index }) => solvedAfter(entries, index, sig)).length,
  };
};
