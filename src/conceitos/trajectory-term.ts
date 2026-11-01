import type { DomainTrajectory, Week } from "./trajectory.js";
import { type Band, BAND_ORDER, bandAt, lastWeek, markIn, markLevel, peakOf } from "./trajectory-bands.js";
import { type Ink, TERM_PALETTE, type Theme } from "./trajectory-palette.js";

export type Cellband = Band | "gap";

export interface TermCell {
  readonly glyph: string;
  readonly band: Cellband | null;
  readonly ink: Ink | null;
}

export interface TermLabels {
  readonly band: Readonly<Record<Band, string>>;
  readonly gap: string;
  readonly line: string;
  readonly ricochet: string;
  readonly held: string;
  readonly hypotheses: string;
  readonly noData: (evidence: number) => string;
  readonly head: (domain: string, from: string, to: string, evidence: number) => string;
}

export const ENGLISH_TERM: TermLabels = {
  band: {
    alone: "does alone",
    proximal: "proximal band",
    unstable: "unstable (calibration)",
    blindCovered: "blind, with criterion",
    blindBare: "blind, without criterion",
    blind: "blind, no help recorded",
    beyond: "beyond the horizon",
  },
  gap: "no evidence",
  line: "work landed",
  ricochet: "ricochet",
  held: "held",
  hypotheses:
    "not drawn (hypothesis): transfer vs known context, explains vs detects only, recognizable vs out of reach",
  noData: (evidence) => `no data (${String(evidence)} weighted events)`,
  head: (domain, from, to, evidence) => `${domain}, ${from} to ${to}, ${String(evidence)} weighted events`,
};

export interface GridSize {
  readonly rows: number;
  readonly perWeek: number;
}

const rowOf = (level: number, peak: number, rows: number): number =>
  Math.min(rows - 1, Math.max(0, Math.round(rows - (level / peak) * rows - 0.5)));

const bandCell = (week: Week, level: number, peak: number): TermCell => {
  const band = bandAt(week, level, peak);
  return { glyph: " ", band: band ?? "gap", ink: null };
};

const pointCell = (trajectory: DomainTrajectory, week: Week, band: Cellband | null): TermCell => {
  const mark = markIn(trajectory.marks, week.week);
  if (mark === undefined) return { glyph: "●", band, ink: "line" };
  return mark.kind === "ricochet" ? { glyph: "✕", band, ink: "ricochet" } : { glyph: "◉", band, ink: "held" };
};

const pointRows = (trajectory: DomainTrajectory, peak: number, rows: number): readonly (number | null)[] =>
  trajectory.weeks.map((week) => {
    const level = markIn(trajectory.marks, week.week) === undefined ? week.work : markLevel(week);
    return level === null ? null : rowOf(level, peak, rows);
  });

const trailRow = (points: readonly (number | null)[], column: number, perWeek: number): number | null => {
  const center = Math.floor(perWeek / 2);
  const index = Math.floor((column - center) / perWeek);
  const from = points[index];
  const to = points[index + 1];
  if (from === null || from === undefined || to === null || to === undefined) return null;
  const offset = column - (index * perWeek + center);
  if (offset <= 0 || offset >= perWeek) return null;
  return Math.round(from + ((to - from) * offset) / perWeek);
};

export const gridOf = (trajectory: DomainTrajectory, size: GridSize): readonly (readonly TermCell[])[] => {
  const peak = peakOf(trajectory);
  const points = pointRows(trajectory, peak, size.rows);
  const center = Math.floor(size.perWeek / 2);
  return Array.from({ length: size.rows }, (_, row) => {
    const level = (peak * (size.rows - row - 0.5)) / size.rows;
    return trajectory.weeks.flatMap((week, index) =>
      Array.from({ length: size.perWeek }, (_unused, offset): TermCell => {
        const cell = bandCell(week, level, peak);
        if (offset === center && points[index] === row) return pointCell(trajectory, week, cell.band);
        if (trailRow(points, index * size.perWeek + offset, size.perWeek) === row)
          return { glyph: "·", band: cell.band, ink: "line" };
        return cell;
      }),
    );
  });
};

export const rowLabels = (trajectory: DomainTrajectory, rows: number, labels: TermLabels): readonly string[] => {
  const peak = peakOf(trajectory);
  const week = lastWeek(trajectory);
  let previous = "";
  return Array.from({ length: rows }, (_, row) => {
    const band = week === undefined ? undefined : bandAt(week, (peak * (rows - row - 0.5)) / rows, peak);
    const label = band === undefined ? "" : labels.band[band];
    const shown = label === previous ? "" : label;
    previous = label;
    return shown;
  });
};

export const axisLine = (trajectory: DomainTrajectory, perWeek: number): string =>
  trajectory.weeks.map((week) => week.week.slice(-3).padEnd(perWeek).slice(0, perWeek)).join("");

export const usedBands = (trajectory: DomainTrajectory): readonly Band[] => {
  const grid = gridOf(trajectory, { rows: 12, perWeek: 1 });
  const seen = new Set(grid.flat().map((cell) => cell.band));
  return BAND_ORDER.filter((band) => seen.has(band));
};

export const termPalette = (theme: Theme): (typeof TERM_PALETTE)[Theme] => TERM_PALETTE[theme];
