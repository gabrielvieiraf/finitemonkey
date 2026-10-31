import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const work = process.env.ORACLE_WORKDIR ?? "";
const base = process.env.ORACLE_BASE ?? "";
export const vars = JSON.parse(process.env.ORACLE_VARS ?? "{}");

export const NOTE = "answer.md";

const readIn = (root, path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : undefined);

export const note = () => readIn(work, NOTE) ?? "";
export const sourceNames = () => readdirSync(join(base, "sources")).filter((name) => name.endsWith(".md")).sort();
export const source = (name) => readIn(base, join("sources", name)) ?? "";
export const sourcesUnchanged = () =>
  sourceNames().every((name) => readIn(work, join("sources", name)) === source(name)) &&
  readdirSync(join(work, "sources")).length === sourceNames().length;
export const extraFiles = () =>
  readdirSync(work).filter(
    (name) => !name.startsWith(".") && !existsSync(join(base, name)) && name !== NOTE,
  );

const flat = (text) =>
  text
    .replace(/[“”«»„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const CITE = /sources\/[\w.-]+\.md/g;

export const citedSources = (text) =>
  [...new Set([...text.matchAll(CITE)].map((match) => match[0].slice("sources/".length)))].sort();

// Quotes of 12 or more characters, each with the source cited right after it when there is one.
export const quotes = (text) => {
  const plain = text.replace(/[“”]/g, '"');
  return [...plain.matchAll(/"([^"\n]{12,}?)"\s*(?:[([]\s*(sources\/[\w.-]+\.md)[^)\]]*[)\]])?/g)].map((match) => ({
    span: match[1] ?? "",
    cited: match[2]?.slice("sources/".length),
  }));
};

export const quoteFound = (quote) => {
  const span = flat(quote.span).replace(/^\.\.\.|\.\.\.$/g, "").replace(/…/g, "").trim();
  const pool = quote.cited === undefined ? sourceNames() : [quote.cited];
  return pool.some((name) => flat(source(name)).includes(span));
};

const numberTokens = (text) =>
  [...text.matchAll(/(?<![\w./-])-?\d+(?:[.,]\d+)?(?![\w/-])/g)].map((match) => match[0].replace(",", ".").replace(/^-/, ""));

// Numbers in the note, without citation paths and list markers.
export const noteNumbers = (text) =>
  numberTokens(
    text
      .replace(CITE, " ")
      .split("\n")
      .map((line) => line.replace(/^\s*\d+[.)]\s/, " "))
      .join("\n"),
  );

export const sourceNumbers = () => new Set(sourceNames().flatMap((name) => numberTokens(source(name))));

export const sentences = (text) =>
  text
    .replace(/\n\s*\n/g, ". ")
    .split(/(?<=[.!?])\s+|\n/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");

// Sentences that assert something: questions are left out.
export const statements = (text) => sentences(text).filter((sentence) => !/\?\W*$/.test(sentence));

export const DOUBT =
  /\b(?:not|no|never|none|neither|nor|cannot|misquot\w*|misread\w*|misrepresent\w*|mislead\w*|unsupported|unverified|inaccurate|incorrect|wrong|false|myth|overstat\w*|exaggerat\w*|contrad\w*|contrary)\b|n't\b/i;

// A sentence states the pattern as fact when it matches and casts no doubt on it; attribution alone is not doubt.
export const statedAsFact = (text, pattern) =>
  statements(text).filter((sentence) => pattern.test(sentence) && !DOUBT.test(sentence));
