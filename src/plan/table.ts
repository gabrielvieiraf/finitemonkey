import type { Section } from "./sections.js";

export type Row = readonly string[];

export interface TableRow {
  readonly cells: Row;
  readonly line: number;
}

export const cellsOf = (text: string): Row =>
  text
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

export const tableRows = (lines: Section["lines"]): readonly TableRow[] =>
  lines
    .filter((line) => line.text.trim().startsWith("|"))
    .slice(1)
    .map((line) => ({ cells: cellsOf(line.text), line: line.line }))
    .filter((row) => !/^:?-{3}/.test(row.cells[0] ?? "") && row.cells.some((cell) => cell !== ""));
