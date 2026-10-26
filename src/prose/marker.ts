export const ALLOW_MARKER = "finitemonkey:prose-allow";

export const ALLOW_FILE_MARKER = "finitemonkey:prose-allow-file";

export const ALLOW_COMMENT = `<!-- ${ALLOW_MARKER} -->`;

export const ALLOW_FILE_COMMENT = `<!-- ${ALLOW_FILE_MARKER} -->`;

const LINE_MARKER = /<!--\s*finitemonkey:prose-allow\s*-->/;
const FILE_MARKER = /<!--\s*finitemonkey:prose-allow-file\s*-->/;
const ANY_MARKER = /<!--\s*finitemonkey:prose-allow(?:-file)?\s*-->/g;

const INLINE_CODE = /`[^`]*`/g;
const FENCE = /^\s*(```|~~~)/;

const outsideCode = (line: string): string => line.replace(INLINE_CODE, "");

const unfencedLines = (text: string): readonly string[] => {
  let fenced = false;
  return text.split("\n").filter((line) => {
    if (FENCE.test(line)) fenced = !fenced;
    return !fenced && !FENCE.test(line);
  });
};

export const allowsWholeFile = (text: string): boolean =>
  unfencedLines(text).some((line) => FILE_MARKER.test(outsideCode(line)));

export const allowsLine = (line: string): boolean => LINE_MARKER.test(outsideCode(line));

export const markerCount = (text: string): number => text.match(ANY_MARKER)?.length ?? 0;

export const isMarkerOnlyLine = (line: string): boolean =>
  allowsLine(line) && outsideCode(line).replace(LINE_MARKER, "").trim() === "";
