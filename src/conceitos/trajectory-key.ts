import type { DomainTrajectory, Week } from "./trajectory.js";
import {
  type Band,
  BAND_ORDER,
  BANDS,
  describeSplit,
  drawnSplits,
  type Group,
  GROUP_LABEL,
  GROUPS,
  HYPOTHESES,
  lastWeek,
  peakOf,
  strataOf,
} from "./trajectory-bands.js";
import { num, paint, text } from "./trajectory-paint.js";
import { BAND_FILL, type ThemeChoice, type Token } from "./trajectory-palette.js";
import { SPLIT_GROUPS, type SplitGroup } from "./trajectory-split-types.js";

export interface Plot {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly top: number;
  readonly bottom: number;
  readonly peak: number;
}

export const yOf = (plot: Plot, level: number): number => plot.y0 - (level / plot.peak) * (plot.y0 - plot.y1);

export const GROUP_INK: Readonly<Record<Group, Token>> = {
  horizon: "hInk",
  blind: "bInk",
  discernment: "uInk",
  proximal: "pInk",
  alone: "iInk",
};

export type Fill = Token | `url(#${string})`;

export const swatchOf = (band: Band): Fill =>
  band === "blindBare" ? "url(#hatch)" : band === "blindCovered" ? "url(#dots)" : BAND_FILL[band];

interface Hypothesis {
  readonly kind: "hypothesis";
  readonly label: string;
  readonly drawn: string | undefined;
}
type Line = { readonly kind: "band"; readonly band: Band } | Hypothesis;

const seen = (trajectory: DomainTrajectory): ReadonlySet<Band> =>
  new Set(trajectory.weeks.flatMap((week) => strataOf(week, peakOf(trajectory)).map((stratum) => stratum.band)));

const isSplit = (group: Group): group is SplitGroup => (SPLIT_GROUPS as readonly string[]).includes(group);

const linesOf = (group: Group, present: ReadonlySet<Band>, drawn: ReadonlySet<SplitGroup>): readonly Line[] => {
  const bands = BAND_ORDER.filter((band) => BANDS[band].group === group && (band !== "blind" || present.has(band)));
  const hypothesis = HYPOTHESES[group];
  const split = isSplit(group) && drawn.has(group) ? `${describeSplit(group)} · calibration` : undefined;
  return [
    ...bands.map((band): Line => ({ kind: "band", band })),
    ...(hypothesis === undefined ? [] : [{ kind: "hypothesis" as const, label: hypothesis, drawn: split }]),
  ];
};

const rangeOf = (week: Week | undefined, group: Group, peak: number): readonly [number, number] | undefined => {
  if (week === undefined) return undefined;
  const mine = strataOf(week, peak).filter((stratum) => BANDS[stratum.band].group === group);
  if (mine.length === 0) return undefined;
  return [Math.min(...mine.map((item) => item.from)), Math.max(...mine.map((item) => item.to))];
};

const LH = 13;
const GAP = 8;

interface Block {
  readonly group: Group;
  readonly lines: readonly Line[];
  readonly range: readonly [number, number] | undefined;
  readonly height: number;
  top: number;
}

const placed = (plot: Plot, trajectory: DomainTrajectory): readonly Block[] => {
  const week = lastWeek(trajectory);
  const present = seen(trajectory);
  const drawn = drawnSplits(trajectory);
  let floor = plot.top;
  const blocks = GROUPS.map((group): Block => {
    const lines = linesOf(group, present, drawn);
    const range = rangeOf(week, group, plot.peak);
    const height = LH * (1 + lines.reduce((sum, line) => sum + (line.kind === "hypothesis" ? 2 : 1), 0));
    const want = range === undefined ? floor : (yOf(plot, range[1]) + yOf(plot, range[0])) / 2 - height / 2;
    const top = Math.max(want, floor);
    floor = top + height + GAP;
    return { group, lines, range, height, top };
  });
  let ceil = plot.bottom;
  for (const block of [...blocks].reverse()) {
    block.top = Math.min(block.top, ceil - block.height);
    ceil = block.top - GAP;
  }
  return blocks;
};

const bandLine = (theme: ThemeChoice, band: Band, x: number, y: number): string => {
  const info = BANDS[band];
  const label = info.status === "calibration" ? `${info.label} · calibration` : info.label;
  const dashed = band === "unstable" ? ` stroke-dasharray="3 2"` : "";
  const stroke = band === "unstable" ? "uInk" : "rule";
  return [
    `<rect x="${num(x)}" y="${num(y - 8)}" width="9" height="9" stroke-width="0.8"${dashed} ${paint(theme, { cls: `key-swatch key-${band}`, fill: swatchOf(band), stroke })}/>`,
    text(theme, { x: x + 14, y }, label, { size: 10, fill: "muted" }),
  ].join("");
};

const hypothesisLine = (theme: ThemeChoice, line: Hypothesis, x: number, y: number): string =>
  [
    `<rect x="${num(x)}" y="${num(y - 8)}" width="9" height="9" stroke-width="0.8" stroke-dasharray="2 2" ${paint(theme, { cls: line.drawn === undefined ? "key-hypothesis" : "key-split", stroke: line.drawn === undefined ? "faint" : "muted" })}/>`,
    text(theme, { x: x + 14, y }, line.label, { size: 10, fill: "faint", extra: 'font-style="italic"' }),
    text(theme, { x: x + 14, y: y + LH }, line.drawn ?? "hypothesis, not drawn", {
      size: 9.5,
      fill: "faint",
      extra: 'font-style="italic"',
    }),
  ].join("");

const blockOf = (theme: ThemeChoice, plot: Plot, block: Block): string => {
  const ink = GROUP_INK[block.group];
  const kx = plot.x1 + 22;
  const ty = block.top + LH - 3;
  const parts: string[] = [];
  if (block.range !== undefined) {
    const yTop = yOf(plot, block.range[1]);
    const yBottom = yOf(plot, block.range[0]);
    const mid = (yTop + yBottom) / 2;
    parts.push(
      `<path d="M ${num(plot.x1 + 3)} ${num(yTop + 1)} L ${num(plot.x1 + 8)} ${num(yTop + 1)} L ${num(plot.x1 + 8)} ${num(yBottom - 1)} L ${num(plot.x1 + 3)} ${num(yBottom - 1)}" stroke-width="1.2" ${paint(theme, { cls: `key-bracket`, stroke: ink })}/>`,
      `<path d="M ${num(plot.x1 + 8)} ${num(mid)} L ${num(kx - 6)} ${num(ty - 4)}" stroke-width="0.8" stroke-opacity="0.6" ${paint(theme, { stroke: ink })}/>`,
    );
  }
  parts.push(text(theme, { x: kx, y: ty }, GROUP_LABEL[block.group], { fill: ink, extra: 'font-weight="700"' }));
  let row = 1;
  for (const line of block.lines) {
    const y = ty + LH * row;
    parts.push(line.kind === "band" ? bandLine(theme, line.band, kx, y) : hypothesisLine(theme, line, kx, y));
    row += line.kind === "hypothesis" ? 2 : 1;
  }
  return `<g class="key-group key-${block.group}">${parts.join("")}</g>`;
};

export const keyOf = (theme: ThemeChoice, plot: Plot, trajectory: DomainTrajectory): string =>
  `<g class="key">${placed(plot, trajectory)
    .map((block) => blockOf(theme, plot, block))
    .join("")}</g>`;
