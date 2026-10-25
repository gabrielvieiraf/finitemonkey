export const ALLOW_MARKER = "finitemonkey:prose-allow";

export const ALLOW_FILE_MARKER = "finitemonkey:prose-allow-file";

const LINE_MARKER = /finitemonkey:prose-allow(?!-file)/;

export const allowsWholeFile = (text: string): boolean => text.includes(ALLOW_FILE_MARKER);

export const allowsLine = (line: string): boolean => LINE_MARKER.test(line);

export const markerCount = (text: string): number => text.split(ALLOW_MARKER).length - 1;

export const isMarkerOnlyLine = (line: string): boolean =>
  allowsLine(line) && line.replace(/<!--|-->|finitemonkey:prose-allow/g, "").trim() === "";
