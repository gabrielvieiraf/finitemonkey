import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml } from "../core/yaml/parse.js";
import type { YamlValue } from "../core/yaml/scalar.js";
import { stringifyYaml } from "../core/yaml/write.js";
import type { FmPaths } from "../task/paths.js";
import {
  type Aliases,
  type ConceptId,
  type ConceptLevel,
  conceptPathOf,
  parseConcept,
  parseConceptLevel,
  rankOf,
} from "./concepts.js";

export const BOOK_FILE = "conceitos.yml";

export interface ConceptEntry {
  readonly level: ConceptLevel;
  readonly updatedAt: string;
  readonly streak?: number;
  readonly demonstrated?: boolean;
}

export interface Book {
  readonly concepts: Readonly<Partial<Record<ConceptId, ConceptEntry>>>;
  readonly baselineGreen: number;
  readonly alarmGreen: number;
  readonly aliases?: Aliases;
}

export const EMPTY_BOOK: Book = { concepts: {}, baselineGreen: 0, alarmGreen: -1 };

export const bookPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, BOOK_FILE));

const integer = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) ? parsed : fallback;
};

const entryOf = (raw: unknown): ConceptEntry | undefined => {
  if (!isRecord(raw)) return undefined;
  const level = parseConceptLevel(typeof raw["level"] === "string" ? raw["level"] : undefined);
  const at = raw["updated_at"];
  const streak = raw["streak"];
  if (level === undefined) return undefined;
  return {
    level,
    updatedAt: typeof at === "string" ? at : "",
    ...(typeof streak === "number" && streak > 0 ? { streak } : {}),
    ...(raw["demonstrated"] === true ? { demonstrated: true } : {}),
  };
};

const aliasesOf = (raw: unknown): Aliases => {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).flatMap(([from, to]): readonly (readonly [string, ConceptId | null])[] => {
      const key = conceptPathOf(from);
      if (key === undefined) return [];
      if (to === null || to === "") return [[key, null]];
      const target = typeof to === "string" ? conceptPathOf(to) : undefined;
      return target === undefined ? [] : [[key, target]];
    }),
  );
};

const stronger = (left: ConceptEntry | undefined, right: ConceptEntry): ConceptEntry =>
  left === undefined || rankOf(right.level) > rankOf(left.level)
    ? { ...right, ...(left?.demonstrated === true ? { demonstrated: true } : {}) }
    : { ...left, ...(right.demonstrated === true ? { demonstrated: true } : {}) };

export const conceptsOf = (raw: unknown, aliases: Aliases): Readonly<Record<ConceptId, ConceptEntry>> => {
  const merged: Record<ConceptId, ConceptEntry> = {};
  for (const [key, value] of Object.entries(isRecord(raw) ? raw : {})) {
    const id = parseConcept(key, aliases);
    const entry = entryOf(value);
    if (id !== undefined && entry !== undefined) merged[id] = stronger(merged[id], entry);
  }
  return merged;
};

export const readBook = (runtime: Pick<Runtime, "readText">, paths: FmPaths): Book => {
  const text = runtime.readText(bookPath(paths));
  const parsed = text.ok ? parseYaml(text.value) : undefined;
  if (parsed?.ok !== true || !isRecord(parsed.value)) return EMPTY_BOOK;
  const root = parsed.value;
  const aliases = aliasesOf(root["aliases"]);
  return {
    concepts: conceptsOf(root["concepts"], aliases),
    baselineGreen: integer(root["baseline_green"], 0),
    alarmGreen: integer(root["alarm_green"], -1),
    ...(Object.keys(aliases).length === 0 ? {} : { aliases }),
  };
};

const entryYaml = (entry: ConceptEntry): YamlValue => ({
  level: entry.level,
  updated_at: entry.updatedAt,
  ...(entry.streak === undefined || entry.streak === 0 ? {} : { streak: entry.streak }),
  ...(entry.demonstrated === true ? { demonstrated: true } : {}),
});

export const bookConcepts = (book: Book): readonly ConceptId[] =>
  Object.keys(book.concepts)
    .filter((id) => book.concepts[id] !== undefined)
    .sort();

export const writeBook = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, book: Book): boolean =>
  runtime.writeText(
    bookPath(paths),
    stringifyYaml({
      schema: "finitemonkey/conceitos@1",
      baseline_green: book.baselineGreen,
      alarm_green: book.alarmGreen,
      ...(book.aliases === undefined || Object.keys(book.aliases).length === 0 ? {} : { aliases: book.aliases }),
      concepts: Object.fromEntries(
        bookConcepts(book).flatMap((id) => {
          const entry = book.concepts[id];
          return entry === undefined ? [] : [[id, entryYaml(entry)]];
        }),
      ),
    }),
  ).ok;

export const raise = (book: Book, id: ConceptId, level: ConceptLevel, at: string): Book => {
  const before = book.concepts[id];
  if (rankOf(before?.level) >= rankOf(level)) return book;
  return { ...book, concepts: { ...book.concepts, [id]: { ...before, level, updatedAt: at } } };
};

export const levelSum = (book: Book): number =>
  bookConcepts(book).reduce((sum, id) => sum + rankOf(book.concepts[id]?.level) + 1, 0);
