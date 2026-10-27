import { similarity } from "./similarity.js";
import type { SignalEntry, SignalProfile } from "./store.js";

export const LOOPED_BY = ["none", "model", "person"] as const;
export const FRONTIERS = ["none", "exploration", "judgment"] as const;

export type LoopedBy = (typeof LOOPED_BY)[number];
export type Frontier = (typeof FRONTIERS)[number];

export interface RepeatedError {
  readonly sig: string;
  readonly count: number;
  readonly turns: number;
  readonly sample: string;
}

export interface LoopIndex {
  readonly score: number;
  readonly firing: boolean;
  readonly error: RepeatedError | undefined;
  readonly stalledTurns: number;
  readonly repeatedPrompts: number;
  readonly undoEdits: number;
  readonly fastAccepts: number;
  readonly caughtAfterApproval: number;
  readonly loopedBy: LoopedBy;
  readonly frontier: Frontier;
  readonly files: readonly string[];
}

export interface Thresholds {
  readonly errors: number;
  readonly stalled: number;
  readonly prompts: number;
  readonly undo: number;
}

export const NEAR_DUPLICATE = 0.6;
const MAX_FILES = 5;

export const thresholdsOf = (profile: SignalProfile): Thresholds => ({
  errors: profile.threshold,
  stalled: profile.threshold + 1,
  prompts: Math.max(2, profile.threshold - 1),
  undo: Math.max(2, profile.threshold - 1),
});

type Of<K extends SignalEntry["kind"]> = Extract<SignalEntry, { readonly kind: K }>;

const only = <K extends SignalEntry["kind"]>(entries: readonly SignalEntry[], kind: K): readonly Of<K>[] =>
  entries.filter((entry): entry is Of<K> => entry.kind === kind);

const repeatedError = (entries: readonly SignalEntry[]): RepeatedError | undefined => {
  const groups = new Map<string, Of<"error">[]>();
  for (const entry of only(entries, "error")) groups.set(entry.sig, [...(groups.get(entry.sig) ?? []), entry]);
  let best: RepeatedError | undefined;
  for (const [sig, list] of groups) {
    const last = list.at(-1);
    if (last === undefined || (best !== undefined && best.count >= list.length)) continue;
    best = { sig, count: list.length, turns: new Set(list.map((entry) => entry.turn)).size, sample: last.sample };
  }
  return best;
};

const trailingRun = <T>(list: readonly T[], same: (left: T, right: T) => boolean): number => {
  let run = 0;
  for (let index = list.length - 1; index > 0; index -= 1) {
    const current = list[index];
    const previous = list[index - 1];
    if (current === undefined || previous === undefined || !same(current, previous)) break;
    run += 1;
  }
  return run;
};

const stalledTurns = (prompts: readonly Of<"prompt">[]): number =>
  prompts.at(-1)?.progress === "" ? 0 : trailingRun(prompts, (left, right) => left.progress === right.progress);

const repeatedPrompts = (prompts: readonly Of<"prompt">[]): number =>
  trailingRun(prompts, (left, right) => similarity(left.fp, right.fp) >= NEAR_DUPLICATE);

const caughtAfterApproval = (entries: readonly SignalEntry[], gateFailedAt: string | undefined): number =>
  gateFailedAt === undefined ? 0 : only(entries, "approved").filter((entry) => entry.at < gateFailedAt).length;

const loopedBy = (error: RepeatedError | undefined, prompts: number, thresholds: Thresholds): LoopedBy => {
  if (prompts >= thresholds.prompts) return "person";
  if (error === undefined || error.count < thresholds.errors) return "model";
  return error.turns < error.count ? "model" : "person";
};

const recentFiles = (entries: readonly SignalEntry[]): readonly string[] =>
  [...new Set(only(entries, "edit").map((entry) => entry.file))].slice(-MAX_FILES);

export const computeIndex = (
  entries: readonly SignalEntry[],
  thresholds: Thresholds,
  gateFailedAt?: string,
): LoopIndex => {
  const prompts = only(entries, "prompt");
  const error = repeatedError(entries);
  const stalled = stalledTurns(prompts);
  const repeated = repeatedPrompts(prompts);
  const undo = only(entries, "edit").filter((entry) => entry.undo).length;
  const fastAccepts = only(entries, "approved").filter((entry) => entry.fast).length;
  const caught = caughtAfterApproval(entries, gateFailedAt);
  const score = Math.max(
    (error?.count ?? 0) / thresholds.errors,
    stalled / thresholds.stalled,
    repeated / thresholds.prompts,
    undo / thresholds.undo,
  );
  const firing = score >= 1;
  return {
    score: Math.round(score * 100) / 100,
    firing,
    error,
    stalledTurns: stalled,
    repeatedPrompts: repeated,
    undoEdits: undo,
    fastAccepts,
    caughtAfterApproval: caught,
    loopedBy: firing ? loopedBy(error, repeated, thresholds) : "none",
    frontier: firing ? (fastAccepts + caught > 0 ? "judgment" : "exploration") : "none",
    files: recentFiles(entries),
  };
};
