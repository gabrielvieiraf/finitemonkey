import { numbersIn } from "./numbers.js";
import { keyIndex, perturb, type ProbeKey } from "./probe.js";
import { normalizeSpan, spanIn } from "./span.js";
import type { ClaimEntry, ProbeEntry } from "./types.js";

export type DistractorProposer = (span: string, source: string) => readonly string[] | undefined;

type ProbeFields = Omit<ProbeEntry, "id" | "at" | "type">;

const sentences = (content: string): readonly string[] =>
  content
    .replace(/<[^>]+>/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= 20);

const ordered = (
  seed: string,
  options: readonly string[],
  key: string,
): { options: readonly string[]; key: number } => {
  const first = keyIndex(seed, options.length);
  const rotated = [...options.slice(first), ...options.slice(0, first)];
  return { options: rotated, key: rotated.indexOf(key) };
};

export const unsupportedClaim = (
  claim: ClaimEntry,
  key: ProbeKey,
  content: string,
  concepts: readonly string[],
  proposer: DistractorProposer | undefined,
): ProbeFields | undefined => {
  const other = sentences(content).find((sentence) => !spanIn(key.span, sentence) && !spanIn(sentence, key.span));
  const candidates = [...(proposer?.(key.span, content) ?? []), perturb(key.span)];
  const unsupported = candidates.find(
    (candidate) =>
      candidate.trim() !== "" && normalizeSpan(candidate) !== normalizeSpan(key.span) && !spanIn(candidate, content),
  );
  if (other === undefined || unsupported === undefined) return undefined;
  const { options, key: index } = ordered(`${claim.id}\u0000${key.hash}`, [key.span, other, unsupported], unsupported);
  return {
    claim: claim.id,
    concepts,
    form: "unsupported-claim",
    prompt: key.ref,
    options,
    key: index,
    keyHash: key.hash,
  };
};

export const predictNumber = (
  claim: ClaimEntry,
  key: ProbeKey,
  concepts: readonly string[],
): ProbeFields | undefined => {
  const [found] = numbersIn(key.span);
  if (found === undefined || found.value === 0) return undefined;
  const values = [found.value, found.value * 10, found.value / 10].map((value) => String(Number(value.toPrecision(6))));
  const right = values[0] ?? "";
  const { options, key: index } = ordered(`${claim.id}\u0000${key.hash}\u0000n`, values, right);
  return { claim: claim.id, concepts, form: "predict-number", prompt: key.ref, options, key: index, keyHash: key.hash };
};
