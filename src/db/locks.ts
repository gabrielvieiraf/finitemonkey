import { MIGRATION_FILE } from "../deploy/migrations.js";
import type { Change } from "../gate/git.js";

export const ENGINES = ["postgres", "mysql", "sqlite"] as const;

export type Engine = (typeof ENGINES)[number];

export const LOCK_RISKS = [
  "index-not-concurrent",
  "column-type",
  "rename",
  "constraint-validated",
  "set-not-null",
] as const;

export type LockRisk = (typeof LOCK_RISKS)[number];

export interface LockFinding {
  readonly kind: LockRisk;
  readonly file: string;
  readonly line: number;
}

interface LockRule {
  readonly kind: LockRisk;
  readonly pattern: RegExp;
  readonly unless?: RegExp;
}

const POSTGRES: readonly LockRule[] = [
  { kind: "index-not-concurrent", pattern: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i, unless: /\bCONCURRENTLY\b/i },
  { kind: "column-type", pattern: /\bALTER\s+COLUMN\s+\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i },
  { kind: "rename", pattern: /\bRENAME\s+(?:COLUMN\s+|TO\b)/i },
  {
    kind: "constraint-validated",
    pattern: /\bADD\s+CONSTRAINT\s+\S+\s+(?:FOREIGN\s+KEY|CHECK)\b/i,
    unless: /\bNOT\s+VALID\b/i,
  },
  { kind: "set-not-null", pattern: /\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/i },
];

const MYSQL: readonly LockRule[] = [
  { kind: "column-type", pattern: /\b(?:MODIFY|CHANGE)\s+(?:COLUMN\s+)?\S+/i },
  { kind: "rename", pattern: /\bRENAME\s+(?:COLUMN|TABLE|TO)\b/i },
  {
    kind: "index-not-concurrent",
    pattern: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i,
    unless: /\bALGORITHM\s*=\s*INPLACE\b/i,
  },
];

const RULES: Readonly<Record<Engine, readonly LockRule[]>> = { postgres: POSTGRES, mysql: MYSQL, sqlite: [] };

const withoutComments = (text: string): string =>
  text
    .replace(/--[^\n]*/g, (comment) => " ".repeat(comment.length))
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));

export const lockRisks = (file: string, source: string, engine: Engine): readonly LockFinding[] => {
  const text = withoutComments(source.replace(/\r\n/g, "\n"));
  const findings: LockFinding[] = [];
  let offset = 0;
  for (const statement of text.split(";")) {
    for (const rule of RULES[engine]) {
      const match = rule.pattern.exec(statement);
      if (match === null || rule.unless?.test(statement) === true) continue;
      findings.push({ kind: rule.kind, file, line: text.slice(0, offset + match.index).split("\n").length });
    }
    offset += statement.length + 1;
  }
  return findings;
};

export interface AppliedEdit {
  readonly kind: "applied-edited" | "applied-deleted";
  readonly file: string;
}

export const appliedEdits = (changes: readonly Change[]): readonly AppliedEdit[] =>
  changes.flatMap((change): AppliedEdit[] => {
    const before = change.oldPath ?? change.path;
    if (!MIGRATION_FILE.test(before)) return [];
    if (change.status === "D" || change.status === "R") return [{ kind: "applied-deleted", file: before }];
    return change.status === "M" ? [{ kind: "applied-edited", file: change.path }] : [];
  });

export const engineOf = (value: string | undefined): Engine =>
  ENGINES.find((engine) => engine === value?.toLowerCase()) ?? "postgres";
