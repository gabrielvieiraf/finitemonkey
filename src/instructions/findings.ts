import { INSTRUCTION_LINE_CEILING } from "../doctor/instructions.js";
import { similarity, type Statement, statementsOf } from "./statements.js";
import type { InstructionFile, Inventory } from "./types.js";

export const SAME_RULE_SIMILARITY = 0.75;
export const CONFLICT_SIMILARITY = 0.6;

export interface StatementRef {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export type InstructionFinding =
  | { readonly kind: "oversized"; readonly file: string; readonly lines: number; readonly max: number }
  | { readonly kind: "duplicate"; readonly first: StatementRef; readonly second: StatementRef }
  | { readonly kind: "conflict"; readonly first: StatementRef; readonly second: StatementRef }
  | { readonly kind: "volatile"; readonly at: StatementRef; readonly reason: string }
  | { readonly kind: "shadowed"; readonly file: string; readonly by: string };

const ref = (statement: Statement): StatementRef => ({
  file: statement.file,
  line: statement.line,
  text: statement.text,
});

interface Located {
  readonly file: InstructionFile;
  readonly statement: Statement;
}

const located = (files: readonly InstructionFile[]): readonly Located[] =>
  files.flatMap((file) => statementsOf(file.display, file.text).map((statement) => ({ file, statement })));

const pairs = (items: readonly Located[]): readonly (readonly [Located, Located])[] =>
  items.flatMap((left, index) =>
    items.slice(index + 1).flatMap((right) => (left.file.layer === right.file.layer ? [] : [[left, right] as const])),
  );

const crossLayer = (items: readonly Located[]): readonly InstructionFinding[] =>
  pairs(items).flatMap(([left, right]): readonly InstructionFinding[] => {
    const score = similarity(left.statement, right.statement);
    const first = ref(left.statement);
    const second = ref(right.statement);
    if (left.statement.negated !== right.statement.negated)
      return score >= CONFLICT_SIMILARITY ? [{ kind: "conflict", first, second }] : [];
    return score >= SAME_RULE_SIMILARITY ? [{ kind: "duplicate", first, second }] : [];
  });

const volatile = (items: readonly Located[]): readonly InstructionFinding[] => {
  const lasting = items.filter((item) => item.file.survivesCompaction);
  return items
    .filter((item) => !item.file.survivesCompaction)
    .filter((item) => !lasting.some((other) => similarity(item.statement, other.statement) >= SAME_RULE_SIMILARITY))
    .map((item) => ({ kind: "volatile", at: ref(item.statement), reason: item.file.reason }));
};

export const instructionFindings = (inventory: Inventory): readonly InstructionFinding[] => {
  const items = located(inventory.files);
  return [
    ...inventory.files
      .filter((file) => file.lines > INSTRUCTION_LINE_CEILING)
      .map((file): InstructionFinding => ({
        kind: "oversized",
        file: file.display,
        lines: file.lines,
        max: INSTRUCTION_LINE_CEILING,
      })),
    ...crossLayer(items),
    ...volatile(items),
    ...inventory.shadowed.map((file): InstructionFinding => ({ kind: "shadowed", file: file.display, by: file.by })),
  ];
};
