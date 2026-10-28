import { isRecord, parseJson } from "../core/parsed.js";

export interface CopyMatch {
  readonly file: string;
  readonly key: string;
  readonly phrase: string;
}

const normalize = (text: string): string => text.toLowerCase().replace(/\s+/g, " ");

export const phraseIn = (text: string, phrases: readonly string[]): string | undefined => {
  const haystack = normalize(text);
  return phrases.find((phrase) => haystack.includes(normalize(phrase.trim())));
};

const entries = (value: unknown, prefix: string): readonly (readonly [string, string])[] => {
  if (typeof value === "string") return [[prefix, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => entries(item, `${prefix}[${String(index)}]`));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, inner]) => entries(inner, prefix === "" ? key : `${prefix}.${key}`));
};

export const catalogMatches = (file: string, text: string, phrases: readonly string[]): readonly CopyMatch[] => {
  const parsed = parseJson(text);
  if (!parsed.ok || phrases.length === 0) return [];
  return entries(parsed.value, "").flatMap(([key, value]) => {
    const phrase = phraseIn(value, phrases);
    return phrase === undefined ? [] : [{ file, key, phrase }];
  });
};
