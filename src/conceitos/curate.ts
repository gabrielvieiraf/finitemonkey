import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { type Book, bookConcepts, type ConceptEntry, readBook, writeBook } from "./book.js";
import { type ConceptId, parseConcept, rankOf } from "./concepts.js";
import { knownConcepts, readConceptEvents } from "./evidence.js";

export const CURATE_ACTIONS = ["rename", "merge", "forget"] as const;
export type CurateAction = (typeof CURATE_ACTIONS)[number];

export type CurateOutcome =
  | { readonly ok: true; readonly action: CurateAction; readonly from: ConceptId; readonly to: ConceptId | null }
  | {
      readonly ok: false;
      readonly reason: "unknown" | "invalid" | "exists" | "missing" | "same";
      readonly concept: string;
    };

type Io = Pick<Runtime, "readText" | "writeText">;

const known = (runtime: Io, paths: FmPaths, book: Book): readonly ConceptId[] =>
  knownConcepts(readConceptEvents(runtime, paths), bookConcepts(book));

const stronger = (left: ConceptEntry | undefined, right: ConceptEntry | undefined): ConceptEntry | undefined => {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return rankOf(right.level) > rankOf(left.level) ? right : left;
};

const repointed = (book: Book, from: ConceptId, to: ConceptId | null): Book => {
  const aliases = Object.fromEntries(
    Object.entries(book.aliases ?? {})
      .filter(([key]) => key !== to)
      .map(([key, value]) => [key, value === from ? to : value]),
  );
  const { [from]: moved, ...rest } = book.concepts;
  const target = to === null ? undefined : stronger(rest[to], moved);
  return {
    ...book,
    aliases: { ...aliases, [from]: to },
    concepts: to === null || target === undefined ? rest : { ...rest, [to]: target },
  };
};

const sourceOf = (
  runtime: Io,
  paths: FmPaths,
  raw: string | undefined,
): { readonly book: Book; readonly ids: readonly ConceptId[]; readonly from?: ConceptId } => {
  const book = readBook(runtime, paths);
  const ids = known(runtime, paths, book);
  const from = parseConcept(raw, book.aliases ?? {});
  return from !== undefined && ids.includes(from) ? { book, ids, from } : { book, ids };
};

export const curateConcept = (
  runtime: Io,
  paths: FmPaths,
  action: CurateAction,
  rawFrom: string | undefined,
  rawTo?: string,
): CurateOutcome => {
  const { book, ids, from } = sourceOf(runtime, paths, rawFrom);
  if (from === undefined) return { ok: false, reason: "unknown", concept: rawFrom ?? "" };
  if (action === "forget") {
    writeBook(runtime, paths, repointed(book, from, null));
    return { ok: true, action, from, to: null };
  }
  const to = parseConcept(rawTo);
  if (to === undefined) return { ok: false, reason: "invalid", concept: rawTo ?? "" };
  if (to === from) return { ok: false, reason: "same", concept: to };
  if (action === "rename" && ids.includes(to)) return { ok: false, reason: "exists", concept: to };
  if (action === "merge" && !ids.includes(to)) return { ok: false, reason: "missing", concept: to };
  writeBook(runtime, paths, repointed(book, from, to));
  return { ok: true, action, from, to };
};
