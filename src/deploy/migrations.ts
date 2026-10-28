import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { changedFiles, type Git, resolveBase } from "../gate/git.js";

export const MIGRATION_FILE =
  /(^|\/)(prisma\/migrations|migrations|db\/migrate|alembic\/versions|drizzle|supabase\/migrations)\/.+\.sql$/i;

export const MIGRATION_ISSUES = ["drop-column", "not-null-without-default"] as const;

export type MigrationIssueKind = (typeof MIGRATION_ISSUES)[number];

export interface MigrationIssue {
  readonly kind: MigrationIssueKind;
  readonly file: string;
  readonly line: number;
}

const DROP = /\bDROP\s+COLUMN\b/i;
const ADD_NOT_NULL = /\bADD\s+(?:COLUMN\s+)?[^;]*?(?<!\bIS\s)\bNOT\s+NULL\b/i;
const SET_NOT_NULL = /\bALTER\s+COLUMN\s+[^;]*?\bSET\s+NOT\s+NULL\b/i;
const DEFAULT = /\bDEFAULT\b/i;

const withoutComments = (text: string): string =>
  text
    .replace(/--[^\n]*/g, (comment) => " ".repeat(comment.length))
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

export const lintMigration = (file: string, source: string): readonly MigrationIssue[] => {
  const text = withoutComments(source.replace(/\r\n/g, "\n"));
  const issues: MigrationIssue[] = [];
  let offset = 0;
  for (const statement of text.split(";")) {
    const at = (match: RegExpExecArray | null): number => lineOf(text, offset + (match?.index ?? 0));
    const drop = DROP.exec(statement);
    if (drop !== null) issues.push({ kind: "drop-column", file, line: at(drop) });
    const added = ADD_NOT_NULL.exec(statement);
    const clause = added === null ? "" : (statement.slice(added.index).split(/,\s*ADD\b/i)[0] ?? "");
    if (added !== null && !DEFAULT.test(clause))
      issues.push({ kind: "not-null-without-default", file, line: at(added) });
    const set = SET_NOT_NULL.exec(statement);
    if (set !== null) issues.push({ kind: "not-null-without-default", file, line: at(set) });
    offset += statement.length + 1;
  }
  return issues;
};

export const deployBase = (git: Git, branch: string): string => {
  const remote = git.out(["rev-parse", "--verify", "-q", `origin/${branch}^{commit}`])?.trim();
  return remote !== undefined && remote !== "" ? `origin/${branch}` : resolveBase(git, undefined);
};

export const changedMigrations = (git: Git, base: string): readonly string[] =>
  changedFiles(git, base)
    .filter((change) => change.status !== "D" && MIGRATION_FILE.test(change.path))
    .map((change) => change.path);

export const lintChangedMigrations = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
  files: readonly string[],
): readonly MigrationIssue[] =>
  files.flatMap((file) => {
    const text = runtime.readText(toAbsolutePath(join(root, file)));
    return text.ok ? lintMigration(file, text.value) : [];
  });
