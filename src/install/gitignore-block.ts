import { BLOCK_BEGIN, BLOCK_END, COMMITTED_STATE, STATE_DIR } from "./layout.js";

export const gitignoreBlock = (): readonly string[] => [
  BLOCK_BEGIN,
  `${STATE_DIR}/*`,
  ...COMMITTED_STATE.map((path) => `!${STATE_DIR}/${path}`),
  BLOCK_END,
];

const lineBreak = (text: string): string => (text.includes("\r\n") ? "\r\n" : "\n");

const blockRange = (lines: readonly string[]): { start: number; end: number } | undefined => {
  const start = lines.findIndex((line) => line.trimEnd() === BLOCK_BEGIN);
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && line.trimEnd() === BLOCK_END);
  return end < 0 ? undefined : { start, end };
};

export const withBlock = (text: string | undefined): string => {
  const eol = text === undefined ? "\n" : lineBreak(text);
  const block = gitignoreBlock();
  if (text === undefined || text === "") return `${block.join(eol)}${eol}`;
  const lines = text.split(eol);
  const range = blockRange(lines);
  if (range !== undefined) return [...lines.slice(0, range.start), ...block, ...lines.slice(range.end + 1)].join(eol);
  const separator = text.endsWith(eol) ? "" : eol;
  return `${text}${separator}${block.join(eol)}${eol}`;
};

export const withoutBlock = (text: string): string => {
  const eol = lineBreak(text);
  const lines = text.split(eol);
  const range = blockRange(lines);
  if (range === undefined) return text;
  return [...lines.slice(0, range.start), ...lines.slice(range.end + 1)].join(eol);
};

export const hasBlock = (text: string): boolean => blockRange(text.split(lineBreak(text))) !== undefined;
