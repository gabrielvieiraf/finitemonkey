export interface CloneInput {
  readonly file: string;
  readonly before: string | undefined;
  readonly after: string;
}

export interface Clone {
  readonly file: string;
  readonly line: number;
  readonly otherFile: string;
  readonly otherLine: number;
  readonly lines: number;
}

interface Significant {
  readonly line: number;
  readonly text: string;
}

interface Window {
  readonly file: string;
  readonly line: number;
  readonly end: number;
}

const TRIVIAL = /^(?:\/\/|#|\*|\/\*|import\s|from\s+\S+\s+import\s|export\s+\*?\s*\{?[^}]*\}?\s*from\s)/;

export const significantLines = (text: string): readonly Significant[] =>
  text.split("\n").flatMap((raw, index) => {
    const line = raw.trim().replace(/\s+/g, " ");
    return /\w/.test(line) && !TRIVIAL.test(line) ? [{ line: index + 1, text: line }] : [];
  });

const windows = (text: string, size: number): ReadonlyMap<string, readonly [number, number][]> => {
  const lines = significantLines(text);
  const found = new Map<string, [number, number][]>();
  for (let start = 0; start + size <= lines.length; start += 1) {
    const slice = lines.slice(start, start + size);
    const key = slice.map((item) => item.text).join("\n");
    const first = slice[0]?.line ?? 0;
    const last = slice[slice.length - 1]?.line ?? first;
    found.set(key, [...(found.get(key) ?? []), [first, last]]);
  }
  return found;
};

const beforeCounts = (inputs: readonly CloneInput[], size: number): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const input of inputs) {
    if (input.before === undefined) continue;
    for (const [key, spots] of windows(input.before, size)) counts.set(key, (counts.get(key) ?? 0) + spots.length);
  }
  return counts;
};

const afterSpots = (inputs: readonly CloneInput[], size: number): ReadonlyMap<string, readonly Window[]> => {
  const spots = new Map<string, Window[]>();
  for (const input of inputs) {
    for (const [key, ranges] of windows(input.after, size)) {
      const list = spots.get(key) ?? [];
      list.push(...ranges.map(([line, end]) => ({ file: input.file, line, end })));
      spots.set(key, list);
    }
  }
  return spots;
};

const MAX_CLONES = 20;

export const newClones = (inputs: readonly CloneInput[], size: number): readonly Clone[] => {
  const before = beforeCounts(inputs, size);
  const fresh = [...afterSpots(inputs, size)]
    .filter(([key, spots]) => spots.length >= 2 && spots.length > (before.get(key) ?? 0))
    .map(([, spots]) => spots)
    .sort((a, b) => (a[0]?.file ?? "").localeCompare(b[0]?.file ?? "") || (a[0]?.line ?? 0) - (b[0]?.line ?? 0));
  const covered = new Map<string, { end: number; clone: Clone }>();
  const clones: Clone[] = [];
  for (const [first, second] of fresh) {
    if (first === undefined || second === undefined) continue;
    const pair = `${first.file}\n${second.file}`;
    const open = covered.get(pair);
    if (open !== undefined && first.line <= open.end) {
      const grown = { ...open.clone, lines: open.clone.lines + 1 };
      clones[clones.indexOf(open.clone)] = grown;
      covered.set(pair, { end: Math.max(open.end, first.end), clone: grown });
      continue;
    }
    const clone = { file: first.file, line: first.line, otherFile: second.file, otherLine: second.line, lines: size };
    covered.set(pair, { end: first.end, clone });
    clones.push(clone);
  }
  return clones.slice(0, MAX_CLONES);
};
