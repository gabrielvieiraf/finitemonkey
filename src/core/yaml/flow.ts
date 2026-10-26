import { accept, type Parsed, reject } from "../parsed.js";
import { parsePlain, parseQuoted, quotedEnd, type YamlValue } from "./scalar.js";

const OPEN: Readonly<Record<string, string>> = { "[": "]", "{": "}" };

const splitTop = (body: string): Parsed<readonly string[]> => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] ?? "";
    if (char === '"' || char === "'") {
      const end = quotedEnd(body, index);
      if (end < 0) return reject("unterminated quoted string");
      index = end;
    } else if (char in OPEN) depth += 1;
    else if (char === "]" || char === "}") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  if (depth !== 0) return reject("unbalanced brackets");
  const last = body.slice(start);
  if (last.trim() !== "" || parts.length > 0) parts.push(last);
  return accept(parts.map((part) => part.trim()));
};

export const splitKey = (text: string): { readonly key: string; readonly rest: string } | undefined => {
  let index = 0;
  if (text.startsWith('"') || text.startsWith("'")) {
    index = quotedEnd(text, 0) + 1;
    if (index <= 0) return undefined;
  }
  for (; index < text.length; index += 1) {
    const char = text[index];
    if (char === "#" && text[index - 1] === " ") return undefined;
    if (char === ":" && (index + 1 === text.length || text[index + 1] === " ")) {
      return { key: text.slice(0, index).trim(), rest: text.slice(index + 1).trim() };
    }
  }
  return undefined;
};

const keyText = (raw: string): Parsed<string> =>
  raw.startsWith('"') || raw.startsWith("'") ? parseQuoted(raw) : accept(raw);

const flowMap = (parts: readonly string[]): Parsed<YamlValue> => {
  const out: Record<string, YamlValue> = {};
  for (const part of parts) {
    const pair = splitKey(part);
    if (pair === undefined) return reject(`expected "key: value" in flow mapping, got "${part}"`);
    const key = keyText(pair.key);
    if (!key.ok) return key;
    if (key.value in out) return reject(`duplicate key "${key.value}"`);
    const value = parseValue(pair.rest);
    if (!value.ok) return value;
    out[key.value] = value.value;
  }
  return accept(out);
};

const flowSeq = (parts: readonly string[]): Parsed<YamlValue> => {
  const out: YamlValue[] = [];
  for (const part of parts) {
    const value = parseValue(part);
    if (!value.ok) return value;
    out.push(value.value);
  }
  return accept(out);
};

export const parseValue = (text: string): Parsed<YamlValue> => {
  if (text === "") return accept(null);
  const first = text[0] ?? "";
  if (first === '"' || first === "'") return parseQuoted(text);
  const close = OPEN[first];
  if (close === undefined) return parsePlain(text);
  if (!text.endsWith(close)) return reject(`flow collection must end on the same line with "${close}"`);
  const parts = splitTop(text.slice(1, -1));
  if (!parts.ok) return parts;
  return first === "[" ? flowSeq(parts.value) : flowMap(parts.value);
};
