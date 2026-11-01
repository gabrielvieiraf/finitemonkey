export interface KeyedBlock {
  readonly key: string;
  readonly lines: readonly string[];
}

export interface KeyedDoc {
  readonly head: readonly string[];
  readonly blocks: readonly KeyedBlock[];
}

export type Nested = (base: KeyedBlock, ours: KeyedBlock, theirs: KeyedBlock) => KeyedMerge | undefined;

export interface KeyedMerge {
  readonly lines: readonly string[];
  readonly conflicts: readonly string[];
}

const textOf = (lines: readonly string[] | undefined): string | undefined => lines?.join("\n");

const pick = (
  base: readonly string[] | undefined,
  ours: readonly string[] | undefined,
  theirs: readonly string[] | undefined,
): { readonly lines: readonly string[] | undefined } | undefined => {
  const [b, o, t] = [textOf(base), textOf(ours), textOf(theirs)];
  if (o === t) return { lines: ours };
  if (b === o) return { lines: theirs };
  if (b === t) return { lines: ours };
  return undefined;
};

export const hasDuplicateKeys = (doc: KeyedDoc): boolean =>
  new Set(doc.blocks.map((block) => block.key)).size !== doc.blocks.length;

const orderedKeys = (ours: KeyedDoc, theirs: KeyedDoc): readonly string[] => {
  const keys = ours.blocks.map((block) => block.key);
  theirs.blocks.forEach((block, index) => {
    if (keys.includes(block.key)) return;
    const before = theirs.blocks
      .slice(0, index)
      .map((item) => item.key)
      .reverse()
      .find((key) => keys.includes(key));
    keys.splice(before === undefined ? 0 : keys.indexOf(before) + 1, 0, block.key);
  });
  return keys;
};

const blockOf = (doc: KeyedDoc, key: string): KeyedBlock | undefined => doc.blocks.find((block) => block.key === key);

const mergeBlock = (key: string, sides: readonly KeyedDoc[], nested: Nested, conflicts: string[]): string[] => {
  const [base, ours, theirs] = sides.map((doc) => blockOf(doc, key));
  const chosen = pick(base?.lines, ours?.lines, theirs?.lines);
  if (chosen !== undefined) return [...(chosen.lines ?? [])];
  const deeper =
    base !== undefined && ours !== undefined && theirs !== undefined ? nested(base, ours, theirs) : undefined;
  if (deeper === undefined) {
    conflicts.push(key);
    return [...(ours?.lines ?? [])];
  }
  conflicts.push(...deeper.conflicts.map((inner) => `${key}.${inner}`));
  return [...deeper.lines];
};

export const mergeKeyed = (base: KeyedDoc, ours: KeyedDoc, theirs: KeyedDoc, nested: Nested): KeyedMerge => {
  const conflicts: string[] = [];
  const head = pick(base.head, ours.head, theirs.head);
  if (head === undefined) conflicts.push("(head)");
  const sides = [base, ours, theirs];
  const body = orderedKeys(ours, theirs).flatMap((key) => mergeBlock(key, sides, nested, conflicts));
  return { lines: [...(head?.lines ?? ours.head), ...body], conflicts };
};
