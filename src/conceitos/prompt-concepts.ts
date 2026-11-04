import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { type Book, bookConcepts, raise, readBook, writeBook } from "./book.js";
import { recordLevels } from "./book-log.js";
import { type ConceptId, parseConcept, resolveConcept } from "./concepts.js";
import { recordConceptEvents } from "./evidence.js";
import { mentionedConcepts } from "./mentions.js";
import { plainText, studiedConcept } from "./prompt-topics.js";

export interface PromptConcepts {
  readonly ids: readonly ConceptId[];
  readonly created?: ConceptId;
}

const mentionedInBook = (prompt: string, book: Book): readonly ConceptId[] => {
  const aliases = book.aliases ?? {};
  const known = new Set(bookConcepts(book));
  const found = mentionedConcepts(`${prompt}\n${plainText(prompt)}`, [...known, ...Object.keys(aliases)]).flatMap(
    (id) => {
      const target = resolveConcept(id, aliases);
      return target !== undefined && known.has(target) ? [target] : [];
    },
  );
  return [...new Set(found)];
};

export const conceptsInPrompt = (prompt: string, book: Book): PromptConcepts => {
  const mentioned = mentionedInBook(prompt, book);
  if (mentioned.length > 0) return { ids: mentioned };
  const id = parseConcept(studiedConcept(prompt), book.aliases ?? {});
  if (id === undefined) return { ids: [] };
  return book.concepts[id] === undefined ? { ids: [id], created: id } : { ids: [id] };
};

export const recordPromptConcepts = (
  runtime: Pick<Runtime, "appendText" | "mkdir" | "now" | "readText" | "writeText">,
  paths: FmPaths,
  prompt: string,
): PromptConcepts => {
  const before = readBook(runtime, paths);
  const found = conceptsInPrompt(prompt, before);
  if (found.created !== undefined) {
    const after = raise(before, found.created, "seen", runtime.now());
    writeBook(runtime, paths, after);
    recordLevels(runtime, paths, { before, after }, "person");
  }
  recordConceptEvents(
    runtime,
    paths,
    found.ids.map((concept) => ({ concept, kind: "exposure", origin: "person" })),
  );
  return found;
};
