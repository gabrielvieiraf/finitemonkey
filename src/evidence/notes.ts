import type { AbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { sha256Hex } from "../secrets/fingerprint.js";

export const NOTES_REF = "refs/notes/finitemonkey";
export const LEDGER_NOTE_SCHEMA = "finitemonkey/ledger-note@1";
const NOTES_DEPTH = 200;
const RECORD_SEPARATOR = "\u001e";
const NOTE_IDENTITY = {
  GIT_AUTHOR_NAME: "Finite Monkey",
  GIT_AUTHOR_EMAIL: "finitemonkey@localhost",
  GIT_COMMITTER_NAME: "Finite Monkey",
  GIT_COMMITTER_EMAIL: "finitemonkey@localhost",
};

export interface LedgerHead {
  readonly lines: number;
  readonly head: string;
}

export interface Rewrite {
  readonly commit: string;
  readonly lines: number;
}

type NotesRuntime = Pick<Runtime, "readText" | "gitWith">;

const ledgerLines = (text: string): readonly string[] => text.split("\n").filter((line) => line.trim() !== "");

export const ledgerHead = (text: string, upTo?: number): LedgerHead => {
  const lines = ledgerLines(text).slice(0, upTo);
  const head = lines.reduce((previous, line) => sha256Hex(`${previous}\n${line}`), "");
  return { lines: lines.length, head };
};

const headOf = (value: unknown): LedgerHead | undefined =>
  isRecord(value) && typeof value["lines"] === "number" && typeof value["head"] === "string"
    ? { lines: value["lines"], head: value["head"] }
    : undefined;

const ledgersOf = (note: string): JsonObject => {
  const parsed = parseJsonObject(note.trim());
  const ledgers = parsed.ok && parsed.value["schema"] === LEDGER_NOTE_SCHEMA ? parsed.value["ledgers"] : undefined;
  return isRecord(ledgers) ? ledgers : {};
};

const git = (runtime: NotesRuntime, root: AbsolutePath, args: readonly string[]) =>
  runtime.gitWith(args, root, { env: NOTE_IDENTITY });

export const writeLedgerNote = (
  runtime: NotesRuntime,
  root: AbsolutePath,
  task: string,
  ledger: AbsolutePath,
): boolean => {
  const text = runtime.readText(ledger);
  const head = git(runtime, root, ["rev-parse", "--verify", "-q", "HEAD"]);
  if (!text.ok || !head.ok) return false;
  const existing = git(runtime, root, ["notes", `--ref=${NOTES_REF}`, "show", "HEAD"]);
  const ledgers = { ...(existing.ok ? ledgersOf(existing.stdout) : {}), [task]: ledgerHead(text.value) };
  const body = JSON.stringify({ schema: LEDGER_NOTE_SCHEMA, ledgers });
  return git(runtime, root, ["notes", `--ref=${NOTES_REF}`, "add", "-f", "-m", body, "HEAD"]).ok;
};

const notedHeads = (runtime: NotesRuntime, root: AbsolutePath, task: string): readonly (LedgerHead & Rewrite)[] => {
  const format = `--format=${RECORD_SEPARATOR}%H%n%N`;
  const log = git(runtime, root, ["log", `-n${String(NOTES_DEPTH)}`, `--notes=${NOTES_REF}`, format, "HEAD"]);
  if (!log.ok) return [];
  return log.stdout.split(RECORD_SEPARATOR).flatMap((record) => {
    const [commit = "", ...rest] = record.split("\n");
    const head = headOf(ledgersOf(rest.join("\n"))[task]);
    return head === undefined ? [] : [{ ...head, commit }];
  });
};

export const ledgerRewrite = (
  runtime: NotesRuntime,
  root: AbsolutePath,
  task: string,
  ledger: AbsolutePath,
): Rewrite | undefined => {
  const text = runtime.readText(ledger);
  if (!text.ok) return undefined;
  const broken = notedHeads(runtime, root, task).filter((noted) => {
    const current = ledgerHead(text.value, noted.lines);
    return current.lines < noted.lines || current.head !== noted.head;
  });
  const earliest = broken.reduce<(LedgerHead & Rewrite) | undefined>(
    (best, item) => (best === undefined || item.lines < best.lines ? item : best),
    undefined,
  );
  return earliest === undefined ? undefined : { commit: earliest.commit, lines: earliest.lines };
};
