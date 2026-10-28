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

export const DEFAULT_STOP_AFTER = 5;

const firstHypothesis = (entries: readonly SignalEntry[], sig: string): number =>
  entries.findIndex((entry) => entry.kind === "hypothesis" && entry.sig === sig);

const lastError = (entries: readonly SignalEntry[]): Extract<SignalEntry, { kind: "error" }> | undefined => {
  const last = entries.findLast((entry) => entry.kind === "error");
  return last?.kind === "error" ? last : undefined;
};

const failuresAfter = (entries: readonly SignalEntry[], index: number, sig: string): number =>
  entries.slice(index + 1).filter((entry) => entry.kind === "error" && entry.sig === sig).length;

export const pendingAttempt = (entries: readonly SignalEntry[], threshold: number): PendingAttempt | undefined => {
  const last = lastError(entries);
  if (last === undefined) return undefined;
  const hypothesis = firstHypothesis(entries, last.sig);
  const cleared = entries.findLastIndex(
    (entry, index) =>
      entry.kind === "research" || (entry.kind === "release" && entry.sig === last.sig) || index === hypothesis,
  );
  const failed = failuresAfter(entries, cleared, last.sig);
  return failed >= threshold ? { sig: last.sig, failed, sample: last.sample } : undefined;
};

export const stoppedAttempt = (entries: readonly SignalEntry[], stopAfter: number): PendingAttempt | undefined => {
  const last = lastError(entries);
  if (last === undefined) return undefined;
  const released = entries.findLastIndex((entry) => entry.kind === "release" && entry.sig === last.sig);
  const failed = failuresAfter(entries, released, last.sig);
  return failed >= stopAfter ? { sig: last.sig, failed, sample: last.sample } : undefined;
};

export const hypothesesFor = (entries: readonly SignalEntry[], sig: string): readonly string[] =>
  entries.flatMap((entry) => (entry.kind === "hypothesis" && entry.sig === sig ? [entry.text] : []));

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
