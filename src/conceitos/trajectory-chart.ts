import type { DomainTrajectory, Mark, Week } from "./trajectory.js";
import { landedIn, markIn } from "./trajectory-bands.js";
import type { Theme } from "./trajectory-palette.js";
import {
  axisLine,
  ENGLISH_TERM,
  gridOf,
  rowLabels,
  type TermCell,
  type TermLabels,
  termPalette,
} from "./trajectory-term.js";

export { svgOf } from "./trajectory-svg.js";

const PLAIN_LANDED: Readonly<Record<string, string>> = {
  alone: "#",
  proximal: "=",
  unstable: "~",
  blindCovered: ":",
  blindBare: "/",
  blind: ".",
  beyond: "^",
};

export const cellOf = (trajectory: DomainTrajectory, week: Week): string => {
  const mark = markIn(trajectory.marks, week.week);
  if (mark !== undefined) return mark.kind === "ricochet" ? "X" : "O";
  if (week.assisted === null) return "\\";
  if (week.work === null) return "-";
  const band = landedIn(trajectory, week);
  return band === undefined ? "\\" : (PLAIN_LANDED[band] ?? "?");
};

export interface TableLabels {
  readonly domain: string;
  readonly noData: (evidence: number) => string;
  readonly legend: string;
}

export const ENGLISH_TABLE: TableLabels = {
  domain: "domain",
  noData: (evidence) => `no data (${String(evidence)} weighted events)`,
  legend:
    "work landed in: # does alone  = proximal  ~ unstable boundary  : blind with criterion  / blind without  . blind, no help recorded  ^ beyond  X ricochet  O held  - no accepted work  \\ no evidence",
};

export const tableLines = (
  trajectories: readonly DomainTrajectory[],
  labels: TableLabels = ENGLISH_TABLE,
): readonly string[] => {
  const width = Math.max(...trajectories.map((item) => item.domain.length), labels.domain.length);
  const weeks = trajectories.find((item) => item.weeks.length > 0)?.weeks.map((week) => week.week.slice(-3)) ?? [];
  return [
    `${labels.domain.padEnd(width)}  ${weeks.join(" ")}`,
    ...trajectories.map((item) =>
      item.status === "no_data"
        ? `${item.domain.padEnd(width)}  ${labels.noData(item.evidence)}`
        : `${item.domain.padEnd(width)}  ${item.weeks.map((week) => cellOf(item, week).padStart(3)).join(" ")}`,
    ),
    labels.legend,
  ];
};

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export const base64 = (bytes: readonly number[]): string => {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64[(triple >> 18) & 63] ?? "";
    out += BASE64[(triple >> 12) & 63] ?? "";
    out += index + 1 < bytes.length ? (BASE64[(triple >> 6) & 63] ?? "") : "=";
    out += index + 2 < bytes.length ? (BASE64[triple & 63] ?? "") : "=";
  }
  return out;
};

const word = (value: number): readonly number[] => [
  value & 255,
  (value >>> 8) & 255,
  (value >>> 16) & 255,
  (value >>> 24) & 255,
];

export const DEFAULT_COLOR = 0x1000000;
const LABEL_WIDTH = 24;
const GRID_ROWS = 12;

export interface RasterCell {
  readonly glyph: string;
  readonly fg: number;
  readonly bg: number;
}

export interface RasterOptions {
  readonly theme: Theme;
  readonly selected?: Mark;
  readonly labels?: TermLabels;
}

const isSelected = (trajectory: DomainTrajectory, index: number, selected: Mark | undefined): boolean =>
  selected !== undefined && trajectory.weeks[index]?.week === selected.week;

const colored = (cell: TermCell, theme: Theme, selected: boolean): RasterCell => {
  const palette = termPalette(theme);
  const bg = cell.band === null ? DEFAULT_COLOR : cell.band === "gap" ? palette.gap : palette.band[cell.band];
  const marked = selected && (cell.ink === "ricochet" || cell.ink === "held");
  return {
    glyph: cell.glyph,
    fg: cell.ink === null ? DEFAULT_COLOR : palette.ink[cell.ink],
    bg: marked ? palette.select : bg,
  };
};

const textCells = (body: string, width: number, fg: number): readonly RasterCell[] =>
  Array.from({ length: width }, (_, index) => ({ glyph: body[index] ?? " ", fg, bg: DEFAULT_COLOR }));

export const rasterShape = (
  trajectory: DomainTrajectory,
  columns: number,
): { readonly perWeek: number; readonly columns: number; readonly rows: number } => {
  const weeks = Math.max(trajectory.weeks.length, 1);
  const perWeek = Math.min(6, Math.max(2, Math.floor((columns - LABEL_WIDTH - 1) / weeks)));
  return { perWeek, columns: weeks * perWeek + 1 + LABEL_WIDTH, rows: GRID_ROWS + 1 };
};

export const rasterCells = (
  trajectory: DomainTrajectory,
  columns: number,
  options: RasterOptions,
): readonly RasterCell[] => {
  const shape = rasterShape(trajectory, columns);
  const faint = termPalette(options.theme).ink.faint;
  const grid = gridOf(trajectory, { rows: GRID_ROWS, perWeek: shape.perWeek });
  const names = rowLabels(trajectory, GRID_ROWS, options.labels ?? ENGLISH_TERM);
  const plotWidth = shape.columns - 1 - LABEL_WIDTH;
  return [
    ...grid.flatMap((cells, row) => [
      ...cells.map((cell, column) =>
        colored(cell, options.theme, isSelected(trajectory, Math.floor(column / shape.perWeek), options.selected)),
      ),
      ...textCells(` ${names[row] ?? ""}`, LABEL_WIDTH + 1, faint),
    ]),
    ...textCells(axisLine(trajectory, shape.perWeek), plotWidth, faint),
    ...textCells("", LABEL_WIDTH + 1, faint),
  ];
};

export const rasterOf = (
  trajectory: DomainTrajectory,
  columns: number,
  options: RasterOptions,
): { readonly columns: number; readonly rows: number; readonly cells: string } => {
  const shape = rasterShape(trajectory, columns);
  const bytes = rasterCells(trajectory, columns, options).flatMap((cell) => [
    ...word(cell.glyph.codePointAt(0) ?? 32),
    ...word(cell.fg),
    ...word(cell.bg),
  ]);
  return { columns: shape.columns, rows: shape.rows, cells: base64(bytes) };
};
