import type { DomainTrajectory } from "./trajectory.js";
import { type Band, BAND_ORDER } from "./trajectory-bands.js";
import type { Ink, Theme } from "./trajectory-palette.js";
import {
  axisLine,
  type Cellband,
  ENGLISH_TERM,
  gridOf,
  type GridSize,
  rowLabels,
  type TermCell,
  type TermLabels,
  termPalette,
  usedBands,
} from "./trajectory-term.js";

export type ColorDepth = "none" | "256" | "truecolor";

export const colorDepth = (env: Readonly<Partial<Record<string, string>>>, isTTY: boolean): ColorDepth => {
  if (env["NO_COLOR"] !== undefined && env["NO_COLOR"] !== "") return "none";
  const forced = env["FORCE_COLOR"] !== undefined && env["FORCE_COLOR"] !== "0" && env["FORCE_COLOR"] !== "";
  if (!isTTY && !forced) return "none";
  if (env["TERM"] === "dumb" && !forced) return "none";
  const colorterm = (env["COLORTERM"] ?? "").toLowerCase();
  return colorterm === "truecolor" || colorterm === "24bit" || env["FORCE_COLOR"] === "3" ? "truecolor" : "256";
};

const LEVELS = [0, 95, 135, 175, 215, 255];

const nearest = (value: number): number =>
  LEVELS.reduce(
    (best, level, index) => (Math.abs(level - value) < Math.abs((LEVELS[best] ?? 0) - value) ? index : best),
    0,
  );

const rgb = (color: number): readonly [number, number, number] => [
  (color >> 16) & 255,
  (color >> 8) & 255,
  color & 255,
];

const PICKED: ReadonlyMap<number, number> = new Map([
  [0x1b4a35, 22],
  [0x203a66, 17],
  [0x3d2d55, 60],
  [0x4a3a1c, 58],
  [0x5a2420, 52],
  [0x3b2723, 95],
  [0x191e25, 234],
  [0x252c36, 238],
  [0xcfe7da, 151],
  [0xcddbf2, 153],
  [0xd9c6e8, 183],
  [0xe9e1d3, 187],
  [0xf3dedb, 217],
  [0xf6ebe9, 224],
  [0xeff1f4, 255],
  [0xe3e6eb, 252],
]);

export const ansi256 = (color: number): number => {
  const picked = PICKED.get(color);
  if (picked !== undefined) return picked;
  const [r, g, b] = rgb(color);
  const cube = 16 + 36 * nearest(r) + 6 * nearest(g) + nearest(b);
  const cubeRgb = [nearest(r), nearest(g), nearest(b)].map((index) => LEVELS[index] ?? 0);
  const gray = Math.min(23, Math.max(0, Math.round(((r + g + b) / 3 - 8) / 10)));
  const grayValue = 8 + gray * 10;
  const distance = (other: readonly number[]): number =>
    (r - (other[0] ?? 0)) ** 2 + (g - (other[1] ?? 0)) ** 2 + (b - (other[2] ?? 0)) ** 2;
  return distance([grayValue, grayValue, grayValue]) < distance(cubeRgb) ? 232 + gray : cube;
};

const colorCode = (color: number, layer: 38 | 48, depth: ColorDepth): string => {
  if (depth === "truecolor") return `${String(layer)};2;${rgb(color).join(";")}`;
  return `${String(layer)};5;${String(ansi256(color))}`;
};

const RESET = "\u001b[0m";

const style = (fg: number | null, bg: number | null, depth: ColorDepth, bold: boolean): string => {
  const codes = [
    ...(bold ? ["1"] : []),
    ...(fg === null ? [] : [colorCode(fg, 38, depth)]),
    ...(bg === null ? [] : [colorCode(bg, 48, depth)]),
  ];
  return codes.length === 0 ? "" : `\u001b[${codes.join(";")}m`;
};

const PLAIN: Readonly<Record<Cellband, string>> = {
  alone: "#",
  proximal: "=",
  unstable: "~",
  blindCovered: ":",
  blindBare: "/",
  blind: ".",
  beyond: " ",
  gap: "\\",
};

const PLAIN_GLYPH: Readonly<Record<string, string>> = { "●": "*", "·": "+", "✕": "X", "◉": "O" };

const plainCell = (cell: TermCell): string =>
  cell.glyph === " " ? (cell.band === null ? " " : PLAIN[cell.band]) : (PLAIN_GLYPH[cell.glyph] ?? cell.glyph);

const cellStyle = (cell: TermCell, theme: Theme, depth: ColorDepth): string => {
  const palette = termPalette(theme);
  const bg = cell.band === null ? null : cell.band === "gap" ? palette.gap : palette.band[cell.band];
  const fg = cell.ink === null ? null : palette.ink[cell.ink];
  return style(fg, bg, depth, cell.ink !== null && cell.glyph !== "·");
};

const colorRow = (cells: readonly TermCell[], theme: Theme, depth: ColorDepth): string => {
  let out = "";
  let current: string | undefined;
  for (const cell of cells) {
    const next = cellStyle(cell, theme, depth);
    if (next !== current) out += `${current === undefined ? "" : RESET}${next}`;
    current = next;
    out += cell.glyph;
  }
  return `${out}${RESET}`;
};

export interface TermOptions {
  readonly depth: ColorDepth;
  readonly theme: Theme;
  readonly labels?: TermLabels;
  readonly size?: GridSize;
}

const faint = (body: string, options: TermOptions): string =>
  options.depth === "none" || body === ""
    ? body
    : `${style(termPalette(options.theme).ink.faint, null, options.depth, false)}${body}${RESET}`;

export const blockOf = (trajectory: DomainTrajectory, options: TermOptions): readonly string[] => {
  const labels = options.labels ?? ENGLISH_TERM;
  if (trajectory.status === "no_data") return [`${trajectory.domain}: ${labels.noData(trajectory.evidence)}`];
  const size = options.size ?? { rows: 12, perWeek: 4 };
  const grid = gridOf(trajectory, size);
  const names = rowLabels(trajectory, size.rows, labels);
  const head = labels.head(
    trajectory.domain,
    trajectory.weeks[0]?.week ?? "",
    trajectory.weeks.at(-1)?.week ?? "",
    trajectory.evidence,
  );
  return [
    head,
    ...grid.map((cells, row) => {
      const body =
        options.depth === "none" ? cells.map(plainCell).join("") : colorRow(cells, options.theme, options.depth);
      const name = names[row] ?? "";
      return name === "" ? body : `${body} ${faint(name, options)}`;
    }),
    faint(axisLine(trajectory, size.perWeek), options),
  ];
};

const swatch = (band: Cellband, options: TermOptions): string => {
  if (options.depth === "none") return PLAIN[band] === " " ? "' '" : PLAIN[band];
  const palette = termPalette(options.theme);
  return `${style(null, band === "gap" ? palette.gap : palette.band[band], options.depth, false)}  ${RESET}`;
};

const inkSwatch = (glyph: string, ink: Ink, options: TermOptions): string =>
  options.depth === "none"
    ? (PLAIN_GLYPH[glyph] ?? glyph)
    : `${style(termPalette(options.theme).ink[ink], null, options.depth, true)}${glyph}${RESET}`;

export const legendLines = (bands: readonly Band[], options: TermOptions): readonly string[] => {
  const labels = options.labels ?? ENGLISH_TERM;
  const entries = [
    ...bands.map((band) => `${swatch(band, options)} ${labels.band[band]}`),
    `${swatch("gap", options)} ${labels.gap}`,
  ];
  const rows = Array.from({ length: Math.ceil(entries.length / 4) }, (_, index) =>
    entries.slice(index * 4, index * 4 + 4).join("  "),
  );
  return [
    ...rows,
    [
      `${inkSwatch("●", "line", options)} ${labels.line}`,
      `${inkSwatch("✕", "ricochet", options)} ${labels.ricochet}`,
      `${inkSwatch("◉", "held", options)} ${labels.held}`,
    ].join("  "),
    faint(labels.hypotheses, options),
  ];
};

export const chartLines = (trajectories: readonly DomainTrajectory[], options: TermOptions): readonly string[] => {
  const drawn = trajectories.filter((item) => item.status === "ok");
  const used = new Set(drawn.flatMap(usedBands));
  const bands = BAND_ORDER.filter((band) => used.has(band));
  return [
    ...trajectories.flatMap((item, index) => [...(index === 0 ? [] : [""]), ...blockOf(item, options)]),
    ...(drawn.length === 0 ? [] : ["", ...legendLines(bands, options)]),
  ];
};
