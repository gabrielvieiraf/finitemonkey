export const ALLOW_MARKER = "finitemonkey:prose-allow";

export const ALLOW_FILE_MARKER = "finitemonkey:prose-allow-file";

export const ALLOW_COMMENT = `<!-- ${ALLOW_MARKER} -->`;

export const ALLOW_FILE_COMMENT = `<!-- ${ALLOW_FILE_MARKER} -->`;

const LINE_MARKER = /<!--\s*finitemonkey:prose-allow\s*-->/;
const FILE_MARKER = /<!--\s*finitemonkey:prose-allow-file\s*-->/;
const ANY_MARKER = /<!--\s*finitemonkey:prose-allow(?:-file)?\s*-->/g;

export const allowsWholeFile = (text: string): boolean => FILE_MARKER.test(text);

export const allowsLine = (line: string): boolean => LINE_MARKER.test(line);

export const markerCount = (text: string): number => text.match(ANY_MARKER)?.length ?? 0;

export const isMarkerOnlyLine = (line: string): boolean =>
  allowsLine(line) && line.replace(LINE_MARKER, "").trim() === "";
