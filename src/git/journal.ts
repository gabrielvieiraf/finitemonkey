import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, isRecord, optionalString, type Parsed, parseJsonObject, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";

export const JOURNAL_FILE = ".finitemonkey/git-journal.jsonl";
export const JOURNAL_SCHEMA = "finitemonkey/git-journal@1";

export interface JournalEntry {
  readonly schema: typeof JOURNAL_SCHEMA;
  readonly at: string;
  readonly op: string;
  readonly ref: string;
  readonly commit: string;
  readonly head: string | undefined;
  readonly branch: string | undefined;
  readonly index: string | undefined;
  readonly owner: string | undefined;
  readonly command: string | undefined;
  readonly heads: Readonly<Record<string, string>>;
  readonly files?: number;
  readonly skipped?: number;
}

export const journalPath = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(root, JOURNAL_FILE));

const headsOf = (value: unknown): Readonly<Record<string, string>> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : {};

const countOf = (
  record: Readonly<Record<string, unknown>>,
  key: "files" | "skipped",
): Partial<Record<typeof key, number>> => {
  const value = record[key];
  return typeof value === "number" && Number.isInteger(value) ? { [key]: value } : {};
};

export const parseJournalLine = (line: string): JournalEntry | undefined => {
  const parsed = parseJsonObject(line);
  if (!parsed.ok) return undefined;
  const record = parsed.value;
  const ref = optionalString(record, "ref");
  const commit = optionalString(record, "commit");
  const at = optionalString(record, "at");
  if (ref === undefined || commit === undefined || at === undefined) return undefined;
  return {
    schema: JOURNAL_SCHEMA,
    at,
    op: optionalString(record, "op") ?? "",
    ref,
    commit,
    head: optionalString(record, "head"),
    branch: optionalString(record, "branch"),
    index: optionalString(record, "index"),
    owner: optionalString(record, "owner"),
    command: optionalString(record, "command"),
    heads: headsOf(record["heads"]),
    ...countOf(record, "files"),
    ...countOf(record, "skipped"),
  };
};

export const readJournal = (runtime: Runtime, root: AbsolutePath): readonly JournalEntry[] => {
  const text = runtime.readText(journalPath(root));
  if (!text.ok) return [];
  return text.value.split("\n").flatMap((line) => {
    const entry = line.trim() === "" ? undefined : parseJournalLine(line);
    return entry === undefined ? [] : [entry];
  });
};

export const appendJournal = (runtime: Runtime, root: AbsolutePath, entry: JournalEntry): Parsed<undefined> => {
  const path = journalPath(root);
  const made = runtime.mkdir(toAbsolutePath(join(root, ".finitemonkey")));
  if (!made.ok) return made;
  const previous = runtime.readText(path);
  const before = previous.ok ? previous.value : "";
  const separator = before === "" || before.endsWith("\n") ? "" : "\n";
  const written = runtime.writeAtomic(path, `${before}${separator}${JSON.stringify(entry)}\n`);
  return written.ok ? accept(undefined) : reject(written.error);
};
