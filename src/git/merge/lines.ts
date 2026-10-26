export const normalizeLine = (line: string): string => line.replace(/\r$/, "").trim().replace(/\s*,$/, "");

const WEAK = /^[\p{P}\p{S}\s]+$/u;

export const isWeak = (line: string): boolean => WEAK.test(line);

export const meaningful = (lines: readonly string[]): readonly string[] =>
  lines.map(normalizeLine).filter((line) => line !== "");

export const contentLines = (text: string | undefined): readonly string[] =>
  text === undefined ? [] : meaningful(text.split("\n"));

export type Counts = ReadonlyMap<string, number>;

export const countLines = (lines: readonly string[]): Counts => {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
};

export const countOf = (counts: Counts, line: string): number => counts.get(line) ?? 0;

export const containsSequence = (haystack: readonly string[], needle: readonly string[]): boolean => {
  if (needle.length === 0) return true;
  const first = needle[0];
  for (let start = haystack.indexOf(first ?? ""); start >= 0; start = haystack.indexOf(first ?? "", start + 1)) {
    if (needle.every((line, offset) => haystack[start + offset] === line)) return true;
  }
  return false;
};

export const lineNumberOf = (text: string | undefined, needle: string): number | undefined => {
  if (text === undefined) return undefined;
  const index = text.split("\n").findIndex((line) => normalizeLine(line) === needle);
  return index < 0 ? undefined : index + 1;
};
