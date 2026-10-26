export interface Markers {
  readonly begin: string;
  readonly end: string;
}

const lineBreak = (text: string): string => (text.includes("\r\n") ? "\r\n" : "\n");

const blockRange = (lines: readonly string[], markers: Markers): { start: number; end: number } | undefined => {
  const start = lines.findIndex((line) => line.trimEnd() === markers.begin);
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && line.trimEnd() === markers.end);
  return end < 0 ? undefined : { start, end };
};

export const withManagedBlock = (text: string | undefined, markers: Markers, body: readonly string[]): string => {
  const eol = text === undefined ? "\n" : lineBreak(text);
  const block = [markers.begin, ...body, markers.end];
  if (text === undefined || text === "") return `${block.join(eol)}${eol}`;
  const lines = text.split(eol);
  const range = blockRange(lines, markers);
  if (range !== undefined) return [...lines.slice(0, range.start), ...block, ...lines.slice(range.end + 1)].join(eol);
  const separator = text.endsWith(eol) ? "" : eol;
  return `${text}${separator}${block.join(eol)}${eol}`;
};

export const withoutManagedBlock = (text: string, markers: Markers): string => {
  const eol = lineBreak(text);
  const lines = text.split(eol);
  const range = blockRange(lines, markers);
  if (range === undefined) return text;
  return [...lines.slice(0, range.start), ...lines.slice(range.end + 1)].join(eol);
};

export const hasManagedBlock = (text: string, markers: Markers): boolean =>
  blockRange(text.split(lineBreak(text)), markers) !== undefined;
