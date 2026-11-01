import { hasDuplicateKeys, type KeyedBlock, type KeyedDoc, type KeyedMerge, mergeKeyed } from "./keyed.js";

const TABLE = /^\s*\[([^[\]]+)\]\s*(?:#.*)?$/;
const ARRAY_TABLE = /^\s*\[\[/;
const ENTRY = /^\s*((?:"[^"]*"|'[^']*'|[A-Za-z0-9_-]+)(?:\s*\.\s*(?:"[^"]*"|'[^']*'|[A-Za-z0-9_-]+))*)\s*=/;
const MULTILINE_STRING = /"""|'''/;
const ROOT = "";

const splitBy = (lines: readonly string[], keyOf: (line: string) => string | undefined): KeyedDoc | undefined => {
  const head: string[] = [];
  const blocks: { key: string; lines: string[] }[] = [];
  for (const line of lines) {
    const key = keyOf(line);
    if (key !== undefined) blocks.push({ key, lines: [line] });
    else (blocks[blocks.length - 1]?.lines ?? head).push(line);
  }
  const doc = { head, blocks };
  return hasDuplicateKeys(doc) ? undefined : doc;
};

const entryKey = (line: string): string | undefined => ENTRY.exec(line)?.[1]?.replace(/\s+/g, "");

const tableKey = (line: string): string | undefined => {
  const name = TABLE.exec(line)?.[1];
  return name === undefined ? undefined : `[${name.trim()}]`;
};

export const splitToml = (lines: readonly string[]): KeyedDoc | undefined => {
  if (lines.some((line) => ARRAY_TABLE.test(line) || MULTILINE_STRING.test(line))) return undefined;
  const firstTable = lines.findIndex((line) => tableKey(line) !== undefined);
  const rootLines = firstTable < 0 ? lines : lines.slice(0, firstTable);
  const tables = splitBy(firstTable < 0 ? [] : lines.slice(firstTable), tableKey);
  if (tables === undefined) return undefined;
  const root = rootLines.length === 0 ? [] : [{ key: ROOT, lines: [...rootLines] }];
  const doc = { head: [], blocks: [...root, ...tables.blocks] };
  return hasDuplicateKeys(doc) ? undefined : doc;
};

const entries = (block: KeyedBlock): KeyedDoc | undefined =>
  splitBy(block.key === ROOT ? block.lines : block.lines.slice(1), entryKey);

const nestedToml = (base: KeyedBlock, ours: KeyedBlock, theirs: KeyedBlock): KeyedMerge | undefined => {
  const header = block0(ours);
  if (block0(base) !== header || block0(theirs) !== header) return undefined;
  const [b, o, t] = [base, ours, theirs].map(entries);
  if (b === undefined || o === undefined || t === undefined) return undefined;
  const merged = mergeKeyed(b, o, t, () => undefined);
  return { lines: header === undefined ? merged.lines : [header, ...merged.lines], conflicts: merged.conflicts };
};

const block0 = (block: KeyedBlock): string | undefined => (block.key === ROOT ? undefined : block.lines[0]);

export const mergeTomlText = (base: string, ours: string, theirs: string): KeyedMerge | undefined => {
  const docs = [base, ours, theirs].map((text) => splitToml(text.replace(/\r?\n$/, "").split(/\r?\n/)));
  const [b, o, t] = docs;
  if (b === undefined || o === undefined || t === undefined) return undefined;
  return mergeKeyed(b, o, t, nestedToml);
};
