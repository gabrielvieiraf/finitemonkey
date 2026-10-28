import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml } from "../core/yaml/parse.js";
import { stringifyYaml } from "../core/yaml/write.js";
import type { FmPaths } from "../task/paths.js";
import { CONCEPT_IDS, type ConceptId, type ConceptLevel, parseConceptLevel, rankOf } from "./concepts.js";

export const BOOK_FILE = "conceitos.yml";

export interface ConceptEntry {
  readonly level: ConceptLevel;
  readonly updatedAt: string;
}

export interface Book {
  readonly concepts: Readonly<Partial<Record<ConceptId, ConceptEntry>>>;
  readonly baselineGreen: number;
  readonly alarmGreen: number;
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
  return level === undefined ? undefined : { level, updatedAt: typeof at === "string" ? at : "" };
};

export const readBook = (runtime: Pick<Runtime, "readText">, paths: FmPaths): Book => {
  const text = runtime.readText(bookPath(paths));
  const parsed = text.ok ? parseYaml(text.value) : undefined;
  if (parsed?.ok !== true || !isRecord(parsed.value)) return EMPTY_BOOK;
  const root = parsed.value;
  const concepts = isRecord(root["concepts"]) ? root["concepts"] : {};
  return {
    concepts: Object.fromEntries(
      CONCEPT_IDS.flatMap((id) => {
        const entry = entryOf(concepts[id]);
        return entry === undefined ? [] : [[id, entry]];
      }),
    ),
    baselineGreen: integer(root["baseline_green"], 0),
    alarmGreen: integer(root["alarm_green"], -1),
  };
};

export const writeBook = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, book: Book): boolean =>
  runtime.writeText(
    bookPath(paths),
    stringifyYaml({
      schema: "finitemonkey/conceitos@1",
      baseline_green: book.baselineGreen,
      alarm_green: book.alarmGreen,
      concepts: Object.fromEntries(
        CONCEPT_IDS.flatMap((id) => {
          const entry = book.concepts[id];
          return entry === undefined ? [] : [[id, { level: entry.level, updated_at: entry.updatedAt }]];
        }),
      ),
    }),
  ).ok;

export const raise = (book: Book, id: ConceptId, level: ConceptLevel, at: string): Book => {
  const before = book.concepts[id];
  if (rankOf(before?.level) >= rankOf(level)) return book;
  return { ...book, concepts: { ...book.concepts, [id]: { level, updatedAt: at } } };
};

export const levelSum = (book: Book): number =>
  CONCEPT_IDS.reduce((sum, id) => sum + rankOf(book.concepts[id]?.level) + 1, 0);
