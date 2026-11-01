import { withoutComments } from "./locks.js";

export const DESTRUCTIVE_KINDS = ["drop-column", "drop-table", "type-narrowing", "rename"] as const;

export type DestructiveKind = (typeof DESTRUCTIVE_KINDS)[number];

export interface DestructiveStatement {
  readonly kind: DestructiveKind;
  readonly file: string;
  readonly line: number;
  readonly table: string;
  readonly subject: string;
}

const NAME = String.raw`[\w."\`]+`;
const TABLE = new RegExp(String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${NAME})`, "i");
const NARROW_TYPE =
  /^(?:(?:smallint|int2|int4|integer|int|mediumint|tinyint|real|float4|boolean|bool|date)\b|(?:varchar|char|character\s+varying|character|numeric|decimal)\s*\()/i;

interface Rule {
  readonly kind: DestructiveKind;
  readonly pattern: RegExp;
  readonly subject: (match: RegExpExecArray, table: string) => string | undefined;
}

const clean = (name: string | undefined): string => (name ?? "").replace(/["`]/g, "");

const RULES: readonly Rule[] = [
  {
    kind: "drop-column",
    pattern: new RegExp(String.raw`\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(${NAME})`, "i"),
    subject: (match, table) => `${table}.${clean(match[1])}`,
  },
  {
    kind: "drop-table",
    pattern: new RegExp(String.raw`\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(${NAME})`, "i"),
    subject: (match) => clean(match[1]),
  },
  {
    kind: "rename",
    pattern: new RegExp(String.raw`\bRENAME\s+(?:COLUMN\s+(${NAME})\s+TO|TO|TABLE\s+(${NAME})\s+TO)\b`, "i"),
    subject: (match, table) => (match[1] === undefined ? clean(match[2]) || table : `${table}.${clean(match[1])}`),
  },
  {
    kind: "type-narrowing",
    pattern: new RegExp(
      String.raw`\b(?:ALTER\s+COLUMN\s+(${NAME})\s+(?:SET\s+DATA\s+)?TYPE|MODIFY\s+(?:COLUMN\s+)?(${NAME}))\s+([^,;]+)`,
      "i",
    ),
    subject: (match, table) =>
      NARROW_TYPE.test((match[3] ?? "").trim()) ? `${table}.${clean(match[1] ?? match[2])}` : undefined,
  },
];

export const destructiveStatements = (file: string, source: string): readonly DestructiveStatement[] => {
  const text = withoutComments(source.replace(/\r\n/g, "\n"));
  const found: DestructiveStatement[] = [];
  let offset = 0;
  for (const statement of text.split(";")) {
    const table = clean(TABLE.exec(statement)?.[1]);
    for (const rule of RULES) {
      const match = rule.pattern.exec(statement);
      const subject = match === null ? undefined : rule.subject(match, table);
      if (match === null || subject === undefined) continue;
      const line = text.slice(0, offset + match.index).split("\n").length;
      found.push({ kind: rule.kind, file, line, table: rule.kind === "drop-table" ? subject : table, subject });
    }
    offset += statement.length + 1;
  }
  return found;
};

const ROLLBACK = /\broll[\s-]?back\b/i;

const lastSegment = (name: string): string => name.split(".").pop() ?? name;

export const hasRollbackPlan = (criteria: readonly string[], statement: DestructiveStatement): boolean => {
  const fileName = statement.file.split("/").pop() ?? statement.file;
  const names = [statement.file, fileName, statement.subject, lastSegment(statement.subject)].filter(
    (name) => name !== "",
  );
  return criteria.some((criterion) => ROLLBACK.test(criterion) && names.some((name) => criterion.includes(name)));
};
