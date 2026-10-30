import { sha256Hex } from "../secrets/fingerprint.js";

const QUOTES: readonly (readonly [RegExp, string])[] = [
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″«»]/g, '"'],
  [/[‐‑‒–—−]/g, "-"],
];

export const normalizeSpan = (text: string): string =>
  QUOTES.reduce((current, [pattern, plain]) => current.replace(pattern, plain), text.normalize("NFKC"))
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, "$1$2")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export const contentHash = (text: string): string => sha256Hex(normalizeSpan(text)).slice(0, 16);

export const spanIn = (span: string, source: string): boolean => {
  const needle = normalizeSpan(span);
  return needle !== "" && normalizeSpan(source).includes(needle);
};
