import { posix } from "node:path";

export interface CitedQuote {
  readonly line: number;
  readonly span: string;
  readonly cited: string;
}

const MIN_SPAN = 12;
const QUOTE =
  /["“]([^"“”\n]+)["”]\s*(?:\(|\[)\s*(?:\[[^\]\n]*\]\()?\s*<?([^\s()<>[\]]+?\.[A-Za-z0-9]{1,8})(?::\d+(?:-\d+)?)?>?\s*[)\]]/g;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const ELLIPSIS = /\.\.\.|…|\[\.\.\.\]|\[…\]/;

export const flatText = (text: string): string =>
  text
    .replace(/[“”«»„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const localPath = (raw: string): string | undefined => {
  if (URL_SCHEME.test(raw) || raw.startsWith("#")) return undefined;
  const clean = raw.replace(/#.*$/, "");
  return clean === "" ? undefined : clean;
};

export const citedQuotes = (text: string): readonly CitedQuote[] =>
  text.split("\n").flatMap((content, index) =>
    [...content.matchAll(QUOTE)].flatMap((match) => {
      const span = match[1] ?? "";
      const cited = localPath(match[2] ?? "");
      return span.trim().length < MIN_SPAN || cited === undefined ? [] : [{ line: index + 1, span, cited }];
    }),
  );

export const resolveCited = (file: string, cited: string): readonly string[] => {
  const fromRoot = posix.normalize(cited.replace(/^\/+/, ""));
  const fromFile = posix.normalize(posix.join(posix.dirname(file), cited));
  return [...new Set([fromRoot, fromFile])].filter((path) => !path.startsWith(".."));
};

export const quoteIn = (span: string, source: string): boolean => {
  const haystack = flatText(source);
  let from = 0;
  for (const piece of span
    .split(ELLIPSIS)
    .map(flatText)
    .filter((part) => part !== "")) {
    const at = haystack.indexOf(piece, from);
    if (at === -1) return false;
    from = at + piece.length;
  }
  return true;
};
