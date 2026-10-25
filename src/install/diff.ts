export const MAX_DIFF_LINES = 120;

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

export const lineDiff = (path: string, before: string, after: string): readonly string[] => {
  const changes = walk(splitLines(before), splitLines(after)).filter(([op]) => op !== "=");
  if (changes.length === 0) return [];
  const lines = changes.map(([op, line]) => `${op} ${line}`);
  const shown = lines.slice(0, MAX_DIFF_LINES);
  const hidden = lines.length - shown.length;
  return [`--- ${path}`, `+++ ${path}`, ...shown, ...(hidden > 0 ? [`… ${String(hidden)} more`] : [])];
};
