import { accept, type Parsed, reject } from "../parsed.js";

export type YamlValue = string | number | boolean | null | readonly YamlValue[] | { readonly [key: string]: YamlValue };

const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  "0": "\0",
};

const HEX4 = /^[0-9a-fA-F]{4}$/;

const unescapeDouble = (body: string): Parsed<string> => {
  let out = "";
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] ?? "";
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = body[index + 1] ?? "";
    if (next === "u") {
      const hex = body.slice(index + 2, index + 6);
      if (!HEX4.test(hex)) return reject(`bad \\u escape`);
      out += String.fromCharCode(Number.parseInt(hex, 16));
      index += 5;
      continue;
    }
    const mapped = ESCAPES[next];
    if (mapped === undefined) return reject(`unknown escape \\${next}`);
    out += mapped;
    index += 1;
  }
  return accept(out);
};

export const quotedEnd = (text: string, start: number): number => {
  const quote = text[start];
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (quote === '"' && char === "\\") {
      index += 1;
      continue;
    }
    if (char !== quote) continue;
    if (quote === "'" && text[index + 1] === "'") {
      index += 1;
      continue;
    }
    return index;
  }
  return -1;
};

export const parseQuoted = (text: string): Parsed<string> => {
  const end = quotedEnd(text, 0);
  if (end !== text.length - 1) return reject(`unterminated or trailing text after quoted string`);
  const body = text.slice(1, -1);
  return text.startsWith('"') ? unescapeDouble(body) : accept(body.replace(/''/g, "'"));
};

const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?$/;
const UNSUPPORTED = /^[&*!|>%@`]/;

export const parsePlain = (text: string): Parsed<YamlValue> => {
  if (UNSUPPORTED.test(text)) return reject(`unsupported YAML syntax "${text.slice(0, 1)}"`);
  if (text === "true" || text === "false") return accept(text === "true");
  if (text === "null" || text === "~") return accept(null);
  if (NUMBER.test(text)) return accept(Number(text));
  return accept(text);
};
