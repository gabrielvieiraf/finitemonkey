import { containsSequence, countLines, countOf, type Counts, isWeak, meaningful, normalizeLine } from "./lines.js";
import type { Finding, Hunk, Side } from "./types.js";

export interface FileCase {
  readonly path: string;
  readonly base: readonly string[];
  readonly result: readonly string[];
  readonly ours: readonly Hunk[];
  readonly theirs: readonly Hunk[];
}

interface SideHunk {
  readonly side: Side;
  readonly hunk: Hunk;
  readonly added: readonly string[];
}

type Elsewhere = (lines: readonly string[]) => boolean;

const sameHunk = (left: Hunk, right: Hunk): boolean =>
  left.oldStart === right.oldStart &&
  left.oldCount === right.oldCount &&
  left.removed.join("\n") === right.removed.join("\n") &&
  left.added.join("\n") === right.added.join("\n");

const removedIndices = (hunks: readonly Hunk[]): Map<number, string> => {
  const out = new Map<number, string>();
  for (const hunk of hunks) {
    hunk.removed.forEach((line, offset) => out.set(hunk.oldStart + offset, normalizeLine(line)));
  }
  return out;
};

const tally = (lines: Iterable<string>): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const line of lines) if (line !== "") counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
};

interface Removal {
  readonly union: Counts;
  readonly honored: Counts;
  readonly conflicted: ReadonlySet<string>;
}

const removalOf = (ours: readonly Hunk[], theirs: readonly Hunk[], paired: readonly Hunk[]): Removal => {
  const left = removedIndices(ours);
  const right = removedIndices(theirs);
  const agreed = removedIndices(paired);
  const union = new Map([...left, ...right]);
  const conflicted = new Set<string>();
  const honored: string[] = [];
  for (const [index, line] of union) {
    const both = left.has(index) && right.has(index);
    if (both && !agreed.has(index)) conflicted.add(line);
    else honored.push(line);
  }
  return { union: tally(union.values()), honored: tally(honored), conflicted };
};

const missingAdditions = (hunks: readonly SideHunk[], file: FileCase, elsewhere: Elsewhere): Finding[] =>
  hunks.flatMap(({ side, hunk, added }): Finding[] => {
    const strong = added.find((line) => !isWeak(line));
    if (strong === undefined || containsSequence(file.result, added) || elsewhere(added)) return [];
    return [{ kind: "missing-addition", file: file.path, side, line: hunk.newStart, text: strong, weak: false }];
  });

interface Expectation {
  readonly line: string;
  readonly expected: number;
  readonly ceiling: number;
  readonly side: Side | undefined;
}

const expectations = (file: FileCase, hunks: readonly SideHunk[], removal: Removal): readonly Expectation[] => {
  const base = countLines(file.base);
  const addsOf = (side: Side): Counts => tally(hunks.filter((item) => item.side === side).flatMap((item) => item.added));
  const ours = addsOf("ours");
  const theirs = addsOf("theirs");
  const keys = new Set([...base.keys(), ...ours.keys(), ...theirs.keys(), ...removal.union.keys()]);
  return [...keys].map((line) => {
    const left = countOf(ours, line);
    const right = countOf(theirs, line);
    const kept = countOf(base, line) - countOf(removal.union, line);
    const combined = isWeak(line) ? left + right : Math.max(left, right);
    const side: Side | undefined = left > 0 ? "ours" : right > 0 ? "theirs" : undefined;
    return { line, expected: kept + combined, ceiling: kept + left + right, side };
  });
};

const countFindings = (file: FileCase, items: readonly Expectation[], removal: Removal): Finding[] => {
  const result = countLines(file.result);
  return items.flatMap(({ line, expected, ceiling, side }): Finding[] => {
    const actual = countOf(result, line);
    const weak = isWeak(line);
    if (actual < expected) return [{ kind: "count", file: file.path, side, line: undefined, text: line, weak, expected, actual }];
    const honored = countOf(removal.honored, line) > 0 && !removal.conflicted.has(line);
    if (!weak && honored && actual > ceiling) {
      return [{ kind: "removal-not-honored", file: file.path, side: undefined, line: undefined, text: line, weak, expected: ceiling, actual }];
    }
    return [];
  });
};

export const checkFile = (file: FileCase, elsewhere: Elsewhere): readonly Finding[] => {
  const paired = file.theirs.filter((hunk) => file.ours.some((other) => sameHunk(hunk, other)));
  const theirs = file.theirs.filter((hunk) => !paired.includes(hunk));
  const hunks: SideHunk[] = [
    ...file.ours.map((hunk) => ({ side: "ours" as const, hunk, added: meaningful(hunk.added) })),
    ...theirs.map((hunk) => ({ side: "theirs" as const, hunk, added: meaningful(hunk.added) })),
  ];
  const removal = removalOf(file.ours, theirs, paired);
  return [...missingAdditions(hunks, file, elsewhere), ...countFindings(file, expectations(file, hunks, removal), removal)];
};
