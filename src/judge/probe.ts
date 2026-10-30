import { sha256Hex } from "../secrets/fingerprint.js";
import type { ClaimEntry, JudgeAnchor, JudgeEntry, ProbeEntry } from "./types.js";

export interface ProbeKey {
  readonly ref: string;
  readonly span: string;
  readonly hash: string;
}

const spanKey = (anchor: JudgeAnchor): ProbeKey | undefined =>
  anchor.kind === "span" && anchor.span !== undefined && anchor.hash !== ""
    ? { ref: anchor.ref, span: anchor.span, hash: anchor.hash }
    : undefined;

export const claimAnchors = (claim: ClaimEntry, entries: readonly JudgeEntry[]): readonly JudgeAnchor[] => [
  ...claim.anchors,
  ...entries.flatMap((entry) => (entry.type === "support" && entry.claim === claim.id ? (entry.anchors ?? []) : [])),
];

export const keyOf = (claim: ClaimEntry, entries: readonly JudgeEntry[]): ProbeKey | undefined =>
  claimAnchors(claim, entries)
    .map(spanKey)
    .findLast((key) => key !== undefined);

const SWAPS: readonly (readonly [RegExp, string])[] = [
  [/\bmust\b/i, "may"],
  [/\bmay\b/i, "must"],
  [/\balways\b/i, "never"],
  [/\bnever\b/i, "always"],
  [/\bincrease(s|d)?\b/i, "decrease$1"],
  [/\bdecrease(s|d)?\b/i, "increase$1"],
  [/\bbefore\b/i, "after"],
  [/\bafter\b/i, "before"],
  [/\bmore\b/i, "less"],
  [/\bless\b/i, "more"],
  [/\bincludes?\b/i, "excludes"],
  [/\brequired\b/i, "optional"],
];

const shiftDigit = (span: string): string | undefined => {
  const match = /\d/.exec(span);
  if (match === null) return undefined;
  const digit = (Number(match[0]) + 1) % 10;
  return `${span.slice(0, match.index)}${String(digit)}${span.slice(match.index + 1)}`;
};

const swapWord = (span: string): string | undefined => {
  const swap = SWAPS.find(([pattern]) => pattern.test(span));
  return swap === undefined ? undefined : span.replace(swap[0], swap[1]);
};

const swapNeighbours = (span: string): string => {
  const words = span.split(" ");
  const middle = Math.max(1, Math.floor(words.length / 2));
  const [left, right] = [words[middle - 1] ?? "", words[middle] ?? ""];
  return [...words.slice(0, middle - 1), right, left, ...words.slice(middle + 1)].join(" ");
};

export const perturb = (span: string): string => shiftDigit(span) ?? swapWord(span) ?? swapNeighbours(span);

export const keyIndex = (seed: string, size: number): number => Number.parseInt(sha256Hex(seed).slice(0, 8), 16) % size;

export const twoSpans = (
  claim: ClaimEntry,
  key: ProbeKey,
  concepts: readonly string[],
): Omit<ProbeEntry, "id" | "at" | "type"> => {
  const index = keyIndex(`${claim.id}\u0000${key.hash}`, 2);
  const fake = perturb(key.span);
  return {
    claim: claim.id,
    concepts,
    form: "two-spans",
    prompt: key.ref,
    options: index === 0 ? [key.span, fake] : [fake, key.span],
    key: index,
    keyHash: key.hash,
  };
};

export const probesIn = (entries: readonly JudgeEntry[]): readonly ProbeEntry[] =>
  entries.filter((entry): entry is ProbeEntry => entry.type === "probe");

export const answerOf = (probe: string, entries: readonly JudgeEntry[]): "right" | "wrong" | "skipped" | undefined => {
  if (entries.some((entry) => entry.type === "signal" && entry.ref === `skip:probe:${probe}`)) return "skipped";
  if (entries.some((entry) => entry.type === "evidence" && entry.proof === "probe" && entry.ref === `probe:${probe}`))
    return "right";
  return entries.some((entry) => entry.type === "signal" && entry.ref === `probe:${probe}`) ? "wrong" : undefined;
};
