import { proseLines } from "./parse.js";

export interface Statement {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly words: ReadonlySet<string>;
  readonly negated: boolean;
}

export const MIN_STATEMENT_WORDS = 5;

const NEGATORS = new Set([
  "never",
  "not",
  "don't",
  "dont",
  "doesn't",
  "avoid",
  "no",
  "without",
  "nunca",
  "não",
  "nao",
  "evite",
  "sem",
  "jamás",
  "jamas",
  "evita",
  "sin",
]);

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "is",
  "are",
  "be",
  "it",
  "this",
  "that",
  "with",
  "always",
  "must",
  "should",
  "do",
  "use",
  "o",
  "os",
  "as",
  "e",
  "de",
  "da",
  "em",
  "um",
  "uma",
  "que",
  "el",
  "la",
  "los",
  "las",
  "y",
  "en",
  "sempre",
  "siempre",
]);

const SKIPPED = /^(#|\||@|>|<!--|---)/;

export const wordsOf = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .replace(/[`*_"“”()[\]{}.,;:!?]/g, " ")
    .split(/\s+/)
    .filter((word) => word !== "");

export const statementOf = (file: string, line: number, raw: string): Statement | undefined => {
  const text = raw
    .trim()
    .replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, "")
    .trim();
  if (text === "" || SKIPPED.test(text)) return undefined;
  const words = wordsOf(text);
  if (words.length < MIN_STATEMENT_WORDS) return undefined;
  return {
    file,
    line,
    text,
    words: new Set(words.filter((word) => !STOP_WORDS.has(word) && !NEGATORS.has(word))),
    negated: words.some((word) => NEGATORS.has(word)),
  };
};

export const statementsOf = (file: string, text: string): readonly Statement[] =>
  proseLines(text).flatMap(({ line, text: raw }) => {
    const statement = statementOf(file, line, raw);
    return statement === undefined ? [] : [statement];
  });

export const similarity = (left: Statement, right: Statement): number => {
  if (left.words.size === 0 || right.words.size === 0) return 0;
  let shared = 0;
  for (const word of left.words) if (right.words.has(word)) shared += 1;
  return shared / (left.words.size + right.words.size - shared);
};
