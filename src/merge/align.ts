export interface Alignment {
  readonly deleted: ReadonlySet<number>;
  readonly inserted: ReadonlyMap<number, readonly string[]>;
}

export const MAX_ALIGN_CELLS = 250_000;

const lcsTable = (base: readonly string[], side: readonly string[]): readonly Uint32Array[] => {
  const rows = Array.from({ length: base.length + 1 }, () => new Uint32Array(side.length + 1));
  for (let i = base.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    const below = rows[i + 1];
    if (row === undefined || below === undefined) continue;
    for (let j = side.length - 1; j >= 0; j -= 1) {
      row[j] = base[i] === side[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  return rows;
};

export const align = (base: readonly string[], side: readonly string[]): Alignment | undefined => {
  if ((base.length + 1) * (side.length + 1) > MAX_ALIGN_CELLS) return undefined;
  const table = lcsTable(base, side);
  const deleted = new Set<number>();
  const inserted = new Map<number, string[]>();
  const insert = (at: number, line: string): void => {
    inserted.set(at, [...(inserted.get(at) ?? []), line]);
  };
  let i = 0;
  let j = 0;
  while (i < base.length || j < side.length) {
    const take = (table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0);
    if (i < base.length && j < side.length && base[i] === side[j]) {
      i += 1;
      j += 1;
    } else if (j >= side.length || (i < base.length && take)) {
      deleted.add(i);
      i += 1;
    } else {
      insert(i, side[j] ?? "");
      j += 1;
    }
  }
  return { deleted, inserted };
};

export const onlyAdds = (alignment: Alignment): boolean => alignment.deleted.size === 0;

const insideRun = (deleted: ReadonlySet<number>, at: number): boolean => deleted.has(at - 1) && deleted.has(at);

export const disjoint = (ours: Alignment, theirs: Alignment): boolean => {
  for (const line of ours.deleted) if (theirs.deleted.has(line)) return false;
  for (const at of ours.inserted.keys()) if (insideRun(theirs.deleted, at)) return false;
  for (const at of theirs.inserted.keys()) if (insideRun(ours.deleted, at)) return false;
  return true;
};

const sameBlock = (left: readonly string[] | undefined, right: readonly string[] | undefined): boolean =>
  left !== undefined && right?.length === left.length && left.every((line, k) => line === right[k]);

export const combine = (base: readonly string[], ours: Alignment, theirs: Alignment): readonly string[] => {
  const out: string[] = [];
  for (let at = 0; at <= base.length; at += 1) {
    const fromOurs = ours.inserted.get(at);
    const fromTheirs = theirs.inserted.get(at);
    out.push(...(fromOurs ?? []));
    if (!sameBlock(fromOurs, fromTheirs)) out.push(...(fromTheirs ?? []));
    const line = base[at];
    if (line !== undefined && !ours.deleted.has(at) && !theirs.deleted.has(at)) out.push(line);
  }
  return out;
};
