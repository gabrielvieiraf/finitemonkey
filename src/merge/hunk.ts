import { align, type Alignment, combine, disjoint, onlyAdds } from "./align.js";
import type { ConflictSegment } from "./segments.js";

export const MERGE_CLASSES = ["C0", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"] as const;

export type MergeClass = (typeof MERGE_CLASSES)[number];

export type MergeSide = "ours" | "theirs";

export interface HunkContext {
  readonly appendOnly: boolean;
  readonly owner: MergeSide | undefined;
  readonly declaredRemoval: boolean;
}

export interface HunkVerdict {
  readonly cls: MergeClass;
  readonly rule: string;
  readonly resolution: readonly string[] | undefined;
}

const squash = (lines: readonly string[]): string => lines.join("\n").replace(/\s+/g, "");

const verdict = (cls: MergeClass, rule: string, resolution?: readonly string[]): HunkVerdict => ({
  cls,
  rule,
  resolution,
});

const formatting = (hunk: ConflictSegment): HunkVerdict | undefined => {
  if (squash(hunk.ours) === squash(hunk.theirs)) return verdict("C2", "same-text-after-format", hunk.ours);
  if (squash(hunk.ours) === squash(hunk.base)) return verdict("C3", "ours-only-formatted", hunk.theirs);
  if (squash(hunk.theirs) === squash(hunk.base)) return verdict("C3", "theirs-only-formatted", hunk.ours);
  return undefined;
};

const pureRemoval = (alignment: Alignment): boolean => alignment.deleted.size > 0 && alignment.inserted.size === 0;

const removalAgainstChange = (
  hunk: ConflictSegment,
  ours: Alignment,
  theirs: Alignment,
  context: HunkContext,
): HunkVerdict | undefined => {
  const remover = pureRemoval(ours) ? "ours" : pureRemoval(theirs) ? "theirs" : undefined;
  if (remover === undefined) return undefined;
  if (!context.declaredRemoval) return verdict("C6", "removal-against-change");
  return verdict("C6", `removal-declared-${remover}`, remover === "ours" ? hunk.ours : hunk.theirs);
};

const keptBy = (owned: readonly string[], other: Alignment, base: readonly string[]): boolean => {
  const present = new Set(owned);
  const added = [...other.inserted.values()].flat();
  const removed = [...other.deleted].map((index) => base[index] ?? "");
  return added.every((line) => present.has(line)) && removed.every((line) => !present.has(line));
};

const exclusive = (hunk: ConflictSegment, ours: Alignment, theirs: Alignment, owner: MergeSide): HunkVerdict => {
  const owned = owner === "ours" ? hunk.ours : hunk.theirs;
  const other = owner === "ours" ? theirs : ours;
  return keptBy(owned, other, hunk.base)
    ? verdict("C8", `exclusive-scope-${owner}`, owned)
    : verdict("C7", "exclusive-scope-would-lose-other-side");
};

export const classifyHunk = (hunk: ConflictSegment, context: HunkContext): HunkVerdict => {
  const ours = align(hunk.base, hunk.ours);
  const theirs = align(hunk.base, hunk.theirs);
  if (ours === undefined || theirs === undefined) return verdict("C7", "hunk-too-large");
  const removes = ours.deleted.size > 0 || theirs.deleted.size > 0;
  if (context.appendOnly && removes) return verdict("C7", "append-only-registry-would-lose-line");
  if (onlyAdds(ours) && onlyAdds(theirs))
    return verdict("C1", "independent-additions", combine(hunk.base, ours, theirs));
  const formatted = formatting(hunk);
  if (formatted !== undefined) return formatted;
  if (disjoint(ours, theirs)) return verdict("C1", "independent-edits", combine(hunk.base, ours, theirs));
  const removal = removalAgainstChange(hunk, ours, theirs, context);
  if (removal !== undefined) return removal;
  if (context.owner !== undefined) return exclusive(hunk, ours, theirs, context.owner);
  return verdict("C7", "same-lines-changed");
};
