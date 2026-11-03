import type { DomainTrajectory, Week } from "./trajectory.js";
import { type Band, BAND_ORDER, filled, markIn, markLevel, peakOf, strataOf } from "./trajectory-bands.js";
import { type Ink, TERM_PALETTE, type Theme } from "./trajectory-palette.js";
import type { SplitGroup } from "./trajectory-split-types.js";

export type Cellband = Band | "gap";

export interface TermCell {
  readonly glyph: string;
  readonly band: Cellband | null;
  readonly ink: Ink | null;
}

export interface SplitLabels {
  readonly name: Readonly<Record<SplitGroup, string>>;
  readonly measured: (splits: string) => string;
  readonly notDrawn: (splits: string) => string;
}

export const ENGLISH_SPLITS: SplitLabels = {
  name: {
    alone: "transfer vs known context",
    proximal: "explains vs detects only",
    horizon: "recognizable vs out of reach",
  },
  measured: (splits) => `measured from the record (calibration, dashed in the chart): ${splits}`,
  notDrawn: (splits) => `not drawn (hypothesis): ${splits}`,
};

export interface TermLabels {
  readonly band: Readonly<Record<Band, string>>;
  readonly gap: string;
  readonly line: string;
  readonly ricochet: string;
  readonly held: string;
  readonly hypotheses: string;
  readonly research?: ResearchLabels;
  readonly splits?: SplitLabels;
  readonly noData: (evidence: number) => string;
  readonly head: (domain: string, from: string, to: string, evidence: number) => string;
}

export interface ResearchLabels {
  readonly lane: string;
  readonly open: string;
  readonly revert: string;
  readonly agent: string;
  readonly person: string;
}

export const ENGLISH_RESEARCH: ResearchLabels = {
  lane: "research",
  open: "research ricochet, open",
  revert: "fixed by revert",
  agent: "fixed by the agent",
  person: "fixed by the person",
};

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
  research: ENGLISH_RESEARCH,
  noData: (evidence) => `no data (${String(evidence)} weighted events)`,
  head: (domain, from, to, evidence) => `${domain}, ${from} to ${to}, ${String(evidence)} weighted events`,
};

export interface GridSize {
  readonly rows: number;
  readonly perWeek: number;
}

interface Layer {
  readonly band: Band;
  readonly from: number;
  readonly to: number;
}

const layersOf = (trajectory: DomainTrajectory, rows: number): readonly Layer[] => {
  const bands = usedBands(trajectory);
  const base = Math.floor(rows / Math.max(1, bands.length));
  const extra = rows - base * bands.length;
  let at = 0;
  return bands.map((band, index) => {
    const from = at;
    at += base + (index < extra ? 1 : 0);
    return { band, from, to: at };
  });
};

const layerAt = (layers: readonly Layer[], row: number): Layer | undefined =>
  layers.find((layer) => row >= layer.from && row < layer.to);

const rowIn = (layers: readonly Layer[], week: Week, level: number, peak: number): number | null => {
  const strata = strataOf(week, peak);
  const stratum = strata.find((item) => level >= item.from && level < item.to) ?? strata.at(-1);
  const layer = layers.find((item) => item.band === stratum?.band);
  if (stratum === undefined || layer === undefined) return null;
  const height = layer.to - layer.from;
  const share = (level - stratum.from) / Math.max(Number.EPSILON, stratum.to - stratum.from);
  return layer.from + Math.min(height - 1, Math.max(0, Math.floor(share * height)));
};

const pointCell = (trajectory: DomainTrajectory, week: Week, band: Cellband | null): TermCell => {
  const mark = markIn(trajectory.marks, week.week);
  if (mark === undefined) return { glyph: "●", band, ink: "line" };
  return mark.kind === "ricochet" ? { glyph: "✕", band, ink: "ricochet" } : { glyph: "◉", band, ink: "held" };
};

const pointRows = (
  trajectory: DomainTrajectory,
  layers: readonly Layer[],
  rows: number,
): readonly (number | null)[] => {
  const peak = peakOf(trajectory);
  return trajectory.weeks.map((week) => {
    const level = markIn(trajectory.marks, week.week) === undefined ? week.work : markLevel(week);
    const row = level === null || !filled(week) ? null : rowIn(layers, week, level, peak);
    return row === null ? null : rows - 1 - row;
  });
};

const centerOf = (perWeek: number): number => Math.floor(perWeek / 2);

const trailAt = (points: readonly (number | null)[], column: number, perWeek: number): number | undefined => {
  const center = centerOf(perWeek);
  const index = Math.floor((column - center) / perWeek);
  const from = points[index];
  const to = points[index + 1];
  if (from === null || from === undefined || to === null || to === undefined) return undefined;
  return from + ((to - from) * (column - (index * perWeek + center))) / perWeek;
};

const onTrail = (points: readonly (number | null)[], column: number, perWeek: number, row: number): boolean => {
  const here = trailAt(points, column, perWeek);
  if (here === undefined) return false;
  const before = trailAt(points, column - 0.5, perWeek) ?? here;
  const after = trailAt(points, column + 0.5, perWeek) ?? here;
  const low = Math.round(Math.min(before, after));
  const high = Math.round(Math.max(before, after));
  return row >= low && row <= high;
};

const backCell = (week: Week, band: Band | undefined): TermCell => {
  if (band === undefined) return { glyph: " ", band: "gap", ink: null };
  return filled(week) ? { glyph: " ", band, ink: null } : { glyph: "╱", band, ink: "faint" };
};

export const gridOf = (trajectory: DomainTrajectory, size: GridSize): readonly (readonly TermCell[])[] => {
  const layers = layersOf(trajectory, size.rows);
  const points = pointRows(trajectory, layers, size.rows);
  const center = centerOf(size.perWeek);
  return Array.from({ length: size.rows }, (_, row) => {
    const band = layerAt(layers, size.rows - 1 - row)?.band;
    return trajectory.weeks.flatMap((week, index) =>
      Array.from({ length: size.perWeek }, (_unused, offset): TermCell => {
        const cell = backCell(week, band);
        if (offset === center && points[index] === row) return pointCell(trajectory, week, cell.band);
        if (onTrail(points, index * size.perWeek + offset, size.perWeek, row))
          return { glyph: "·", band: cell.band, ink: "line" };
        return cell;
      }),
    );
  });
};

export const rowLabels = (trajectory: DomainTrajectory, rows: number, labels: TermLabels): readonly string[] => {
  const layers = layersOf(trajectory, rows);
  return Array.from({ length: rows }, (_, row) => {
    const layer = layerAt(layers, rows - 1 - row);
    if (layer === undefined) return "";
    return rows - 1 - row === layer.from + Math.floor((layer.to - layer.from - 1) / 2) ? labels.band[layer.band] : "";
  });
};

export const axisLine = (trajectory: DomainTrajectory, perWeek: number): string =>
  trajectory.weeks
    .map((week) => {
      const name = week.week.slice(-3);
      const lead = Math.max(0, Math.min(perWeek - name.length, centerOf(perWeek) - 1));
      return `${" ".repeat(lead)}${name}`.padEnd(perWeek).slice(0, perWeek);
    })
    .join("");

export const usedBands = (trajectory: DomainTrajectory): readonly Band[] => {
  const peak = peakOf(trajectory);
  const seen = new Set(trajectory.weeks.flatMap((week) => strataOf(week, peak).map((stratum) => stratum.band)));
  return BAND_ORDER.filter((band) => seen.has(band));
};

export const termPalette = (theme: Theme): (typeof TERM_PALETTE)[Theme] => TERM_PALETTE[theme];
