export const MAX_DIFF_LINES = 120;
export const MAX_LCS_CELLS = 4_000_000;

type Op = readonly ["=" | "-" | "+", string];

const table = (a: readonly string[], b: readonly string[]): number[][] => {
  const rows = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const row = rows[i] ?? [];
    const below = rows[i + 1] ?? [];
    for (let j = b.length - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  return rows;
};

const walk = (a: readonly string[], b: readonly string[]): readonly Op[] => {
  const lcs = table(a, b);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const left = a[i];
    const right = b[j];
    if (left !== undefined && left === right) {
      ops.push(["=", left]);
      i += 1;
      j += 1;
    } else if (right !== undefined && (left === undefined || (lcs[i]?.[j + 1] ?? 0) >= (lcs[i + 1]?.[j] ?? 0))) {
      ops.push(["+", right]);
      j += 1;
    } else {
      ops.push(["-", left ?? ""]);
      i += 1;
    }
  }
  return ops;
};

const splitLines = (text: string): readonly string[] => (text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/));

const sharedPrefix = (a: readonly string[], b: readonly string[]): number => {
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) count += 1;
  return count;
};

const sharedSuffix = (a: readonly string[], b: readonly string[], prefix: number): number => {
  let count = 0;
  while (count < a.length - prefix && count < b.length - prefix && a[a.length - 1 - count] === b[b.length - 1 - count])
    count += 1;
  return count;
};

const changedOps = (a: readonly string[], b: readonly string[]): readonly Op[] => {
  const prefix = sharedPrefix(a, b);
  const suffix = sharedSuffix(a, b, prefix);
  const left = a.slice(prefix, a.length - suffix);
  const right = b.slice(prefix, b.length - suffix);
  if (left.length * right.length <= MAX_LCS_CELLS) return walk(left, right).filter(([op]) => op !== "=");
  return [...left.map((line): Op => ["-", line]), ...right.map((line): Op => ["+", line])];
};

export const lineDiff = (path: string, before: string, after: string): readonly string[] => {
  const changes = changedOps(splitLines(before), splitLines(after));
  if (changes.length === 0) return [];
  const lines = changes.map(([op, line]) => `${op} ${line}`);
  const shown = lines.slice(0, MAX_DIFF_LINES);
  const hidden = lines.length - shown.length;
  return [`--- ${path}`, `+++ ${path}`, ...shown, ...(hidden > 0 ? [`… ${String(hidden)} more`] : [])];
};
