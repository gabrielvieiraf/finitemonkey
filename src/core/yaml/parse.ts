import { accept, type Parsed, reject } from "../parsed.js";
import { parseValue, splitKey } from "./flow.js";
import { parseQuoted, quotedEnd, type YamlValue } from "./scalar.js";

export type { YamlValue } from "./scalar.js";

export interface YamlError {
  readonly line: number;
  readonly message: string;
}

interface Line {
  readonly number: number;
  readonly indent: number;
  readonly text: string;
}

type Step<T> = Parsed<{ readonly value: T; readonly next: number }, YamlError>;

const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);

const stripComment = (text: string): string => {
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' || char === "'") {
      const end = quotedEnd(text, index);
      if (end < 0) return text;
      index = end;
    } else if (char === "#" && (index === 0 || text[index - 1] === " ")) return text.slice(0, index);
  }
  return text;
};

const toLines = (source: string): Parsed<readonly Line[], YamlError> => {
  const lines: Line[] = [];
  const raw = source.replace(BOM, "").split(/\r?\n/);
  for (const [index, full] of raw.entries()) {
    const text = stripComment(full).trimEnd();
    const body = text.trimStart();
    if (body === "" || (body === "---" && lines.length === 0)) continue;
    const indentText = text.slice(0, text.length - body.length);
    if (indentText.includes("\t")) return reject({ line: index + 1, message: "tabs are not allowed for indentation" });
    if (body === "---" || body === "...")
      return reject({ line: index + 1, message: "only one YAML document is allowed" });
    lines.push({ number: index + 1, indent: indentText.length, text: body });
  }
  return accept(lines);
};

const fail = (line: Line | undefined, message: string): { readonly ok: false; readonly error: YamlError } =>
  reject({ line: line?.number ?? 0, message });

const scalar = (line: Line, text: string): Parsed<YamlValue, YamlError> => {
  const value = parseValue(text);
  return value.ok ? value : fail(line, value.error);
};

const isItem = (text: string): boolean => text === "-" || text.startsWith("- ");

const child = (lines: Line[], index: number, parent: Line, sameIndentSeq: boolean): Step<YamlValue> => {
  const next = lines[index];
  if (next !== undefined && next.indent > parent.indent) return block(lines, index, next.indent);
  if (sameIndentSeq && next?.indent === parent.indent && isItem(next.text)) return block(lines, index, next.indent);
  return accept({ value: null, next: index });
};

const sequence = (lines: Line[], start: number, indent: number): Step<YamlValue> => {
  const out: YamlValue[] = [];
  let index = start;
  for (let line = lines[index]; line?.indent === indent && isItem(line.text); line = lines[index]) {
    const rest = line.text.slice(1).trimStart();
    if (rest === "") {
      const nested = child(lines, index + 1, line, false);
      if (!nested.ok) return nested;
      out.push(nested.value.value);
      index = nested.value.next;
      continue;
    }
    if (rest.startsWith("- ") || splitKey(rest) !== undefined) {
      lines[index] = { number: line.number, indent: indent + (line.text.length - rest.length), text: rest };
      const nested = block(lines, index, lines[index]?.indent ?? indent);
      if (!nested.ok) return nested;
      out.push(nested.value.value);
      index = nested.value.next;
      continue;
    }
    const value = scalar(line, rest);
    if (!value.ok) return value;
    out.push(value.value);
    index += 1;
  }
  return accept({ value: out, next: index });
};

const mapping = (lines: Line[], start: number, indent: number): Step<YamlValue> => {
  const out: Record<string, YamlValue> = {};
  let index = start;
  for (let line = lines[index]; line?.indent === indent && !isItem(line.text); line = lines[index]) {
    const pair = splitKey(line.text);
    if (pair === undefined) return fail(line, `expected "key: value", got "${line.text}"`);
    const key = pair.key.startsWith('"') || pair.key.startsWith("'") ? parseQuoted(pair.key) : accept(pair.key);
    if (!key.ok) return fail(line, key.error);
    if (key.value in out) return fail(line, `duplicate key "${key.value}"`);
    if (pair.rest !== "") {
      const value = scalar(line, pair.rest);
      if (!value.ok) return value;
      out[key.value] = value.value;
      index += 1;
      continue;
    }
    const nested = child(lines, index + 1, line, true);
    if (!nested.ok) return nested;
    out[key.value] = nested.value.value;
    index = nested.value.next;
  }
  return accept({ value: out, next: index });
};

const block = (lines: Line[], start: number, indent: number): Step<YamlValue> => {
  const line = lines[start];
  if (line === undefined) return accept({ value: null, next: start });
  return isItem(line.text) ? sequence(lines, start, indent) : mapping(lines, start, indent);
};

export const parseYaml = (source: string): Parsed<YamlValue, YamlError> => {
  const parsed = toLines(source);
  if (!parsed.ok) return parsed;
  const lines = [...parsed.value];
  const first = lines[0];
  if (first === undefined) return accept(null);
  if (lines.length === 1 && splitKey(first.text) === undefined && !isItem(first.text)) return scalar(first, first.text);
  const result = block(lines, 0, first.indent);
  if (!result.ok) return result;
  const leftover = lines[result.value.next];
  if (leftover !== undefined) return fail(leftover, `unexpected indentation or text "${leftover.text}"`);
  return accept(result.value.value);
};
