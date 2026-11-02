import { parseYaml } from "../core/yaml/parse.js";
import { hasDuplicateKeys, type KeyedBlock, type KeyedDoc, type KeyedMerge, mergeKeyed } from "./keyed.js";

const KEY_LINE = /^(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s#'"\-[{][^:#]*?)\s*:(?:\s|$)/;
const OPENS_BODY = /:\s*(?:#.*)?$/;

const isFiller = (line: string): boolean => line.trim() === "" || line.trimStart().startsWith("#");

const indentOf = (line: string): number => line.length - line.trimStart().length;

const keyOf = (line: string): string | undefined => {
  const match = KEY_LINE.exec(line);
  return match === null ? undefined : match[0].replace(/\s*:\s*$/, "").trim();
};

export const splitYaml = (lines: readonly string[]): KeyedDoc | undefined => {
  const head: string[] = [];
  const blocks: { key: string; lines: string[] }[] = [];
  for (const line of lines) {
    const current = blocks[blocks.length - 1];
    if (isFiller(line) || indentOf(line) > 0) {
      if (current === undefined) {
        if (!isFiller(line)) return undefined;
        head.push(line);
      } else current.lines.push(line);
      continue;
    }
    if (line === "---" && current === undefined) {
      head.push(line);
      continue;
    }
    const key = keyOf(line);
    if (key === undefined) return undefined;
    blocks.push({ key, lines: [line] });
  }
  const doc = { head, blocks };
  return hasDuplicateKeys(doc) ? undefined : doc;
};

const bodyIndent = (body: readonly string[]): number | undefined => {
  const content = body.filter((line) => !isFiller(line));
  if (content.length === 0 || content.some((line) => line.trimStart().startsWith("- "))) return undefined;
  return Math.min(...content.map(indentOf));
};

const dedent = (body: readonly string[], indent: number): readonly string[] | undefined =>
  body.every((line) => line.trim() === "" || indentOf(line) >= indent || line.trimStart().startsWith("#"))
    ? body.map((line) => (indentOf(line) >= indent ? line.slice(indent) : line.trimStart()))
    : undefined;

const nestedYaml = (base: KeyedBlock, ours: KeyedBlock, theirs: KeyedBlock): KeyedMerge | undefined => {
  const sides = [base, ours, theirs];
  const header = ours.lines[0] ?? "";
  if (!OPENS_BODY.test(header) || sides.some((side) => side.lines[0] !== header)) return undefined;
  const indents = sides.map((side) => bodyIndent(side.lines.slice(1)));
  const indent = indents[1];
  if (indent === undefined || indents.some((value) => value !== indent)) return undefined;
  const docs = sides.map((side) => {
    const body = dedent(side.lines.slice(1), indent);
    return body === undefined ? undefined : splitYaml(body);
  });
  const [b, o, t] = docs;
  if (b === undefined || o === undefined || t === undefined) return undefined;
  const merged = mergeKeyed(b, o, t, nestedYaml);
  const pad = " ".repeat(indent);
  return {
    lines: [header, ...merged.lines.map((line) => (line === "" ? line : `${pad}${line}`))],
    conflicts: merged.conflicts,
  };
};

export const mergeYamlText = (base: string, ours: string, theirs: string): KeyedMerge | undefined => {
  const texts = [base, ours, theirs];
  if (texts.some((text) => !parseYaml(text).ok)) return undefined;
  const docs = texts.map((text) => splitYaml(text.replace(/\r?\n$/, "").split(/\r?\n/)));
  const [b, o, t] = docs;
  if (b === undefined || o === undefined || t === undefined) return undefined;
  const merged = mergeKeyed(b, o, t, nestedYaml);
  if (merged.conflicts.length > 0) return merged;
  return parseYaml(`${merged.lines.join("\n")}\n`).ok ? merged : undefined;
};
