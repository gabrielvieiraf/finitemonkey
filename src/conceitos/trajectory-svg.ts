import type { DomainTrajectory, Mark, Week } from "./trajectory.js";
import { type Band, BAND_ORDER, BANDS, landedIn, markIn, markLevel, peakOf, strataOf } from "./trajectory-bands.js";
import { keyOf, type Plot, swatchOf, yOf } from "./trajectory-key.js";
import { defsOf, escapeXml, num, paint, styleOf, text } from "./trajectory-paint.js";
import type { ThemeChoice } from "./trajectory-palette.js";

export const SVG_WIDTH = 900;
export const SVG_HEIGHT = 400;
const LEFT = 46;
const RIGHT = 236;
const TOP = 14;
const BOTTOM = 36;

export interface SvgOptions {
  readonly theme?: ThemeChoice;
  readonly selected?: Mark;
}

interface Frame extends Plot {
  readonly xs: readonly number[];
  readonly half: number;
}

const frameOf = (trajectory: DomainTrajectory): Frame => {
  const x0 = LEFT;
  const x1 = SVG_WIDTH - RIGHT;
  const n = trajectory.weeks.length;
  const xs = trajectory.weeks.map((_, index) => x0 + 14 + (n > 1 ? index / (n - 1) : 0.5) * (x1 - x0 - 28));
  const half = n > 1 ? ((xs[1] ?? 0) - (xs[0] ?? 0)) / 2 : (x1 - x0) / 2;
  const y0 = SVG_HEIGHT - BOTTOM;
  return { x0, x1, y0, y1: TOP, top: TOP, bottom: y0, peak: peakOf(trajectory), xs, half };
};

const runsOf = (weeks: readonly Week[], keep: (week: Week) => boolean): readonly (readonly number[])[] => {
  const runs: number[][] = [];
  let run: number[] = [];
  weeks.forEach((week, index) => {
    if (keep(week)) run.push(index);
    else {
      if (run.length > 0) runs.push(run);
      run = [];
    }
  });
  if (run.length > 0) runs.push(run);
  return runs;
};

const spanOf = (week: Week, band: Band, peak: number): readonly [number, number] => {
  const strata = strataOf(week, peak);
  const own = strata.find((stratum) => stratum.band === band);
  if (own !== undefined) return [own.from, own.to];
  const after = strata.find((stratum) => BAND_ORDER.indexOf(stratum.band) > BAND_ORDER.indexOf(band));
  const at = after?.from ?? peak;
  return [at, at];
};

const filled = (week: Week): boolean => week.assisted !== null;

const bandPath = (
  theme: ThemeChoice,
  frame: Frame,
  band: Band,
  columns: readonly { readonly x: number; readonly span: readonly [number, number] }[],
): string => {
  const top = columns.map(({ x, span }) => `${num(x)} ${num(yOf(frame, span[1]))}`);
  const bottom = columns.map(({ x, span }) => `${num(x)} ${num(yOf(frame, span[0]))}`).reverse();
  const d = `M ${top.join(" L ")} L ${bottom.join(" L ")} Z`;
  const edge =
    band === "unstable"
      ? [top, bottom]
          .map(
            (points) =>
              `<path d="M ${points.join(" L ")}" stroke-width="1" stroke-dasharray="4 3" ${paint(theme, { cls: `band-edge`, stroke: "uInk" })}/>`,
          )
          .join("")
      : "";
  const opacity = band === "unstable" ? ' fill-opacity="0.85"' : "";
  return `<path d="${d}"${opacity} ${paint(theme, { cls: `band band-${band}`, fill: swatchOf(band) })}><title>${escapeXml(BANDS[band].label)}</title></path>${edge}`;
};

const strataPaths = (theme: ThemeChoice, frame: Frame, weeks: readonly Week[]): readonly string[] =>
  runsOf(weeks, filled).flatMap((run) => {
    const single = run.length === 1;
    const points = run.flatMap((index) => {
      const week = weeks[index];
      const x = frame.xs[index] ?? 0;
      if (week === undefined) return [];
      return single
        ? [
            { x: x - frame.half * 0.8, week },
            { x: x + frame.half * 0.8, week },
          ]
        : [{ x, week }];
    });
    return BAND_ORDER.flatMap((band) => {
      const columns = points.map(({ x, week }) => ({ x, span: spanOf(week, band, frame.peak) }));
      return columns.some(({ span }) => span[1] > span[0]) ? [bandPath(theme, frame, band, columns)] : [];
    });
  });

const gapRects = (theme: ThemeChoice, frame: Frame, weeks: readonly Week[]): readonly string[] =>
  weeks.flatMap((week, index) =>
    filled(week)
      ? []
      : [
          `<rect x="${num((frame.xs[index] ?? 0) - frame.half)}" y="${num(frame.y1)}" width="${num(frame.half * 2)}" height="${num(frame.y0 - frame.y1)}" ${paint(theme, { cls: `gap`, fill: "url(#gap)" })}><title>${escapeXml(`${week.week}: no evidence`)}</title></rect>`,
        ],
  );

const ticksOf = (peak: number): readonly number[] => {
  const step = Math.max(1, Math.ceil(peak / 5));
  return Array.from({ length: Math.floor(peak / step) + 1 }, (_, index) => index * step);
};

const axes = (theme: ThemeChoice, frame: Frame, weeks: readonly Week[]): readonly string[] => [
  ...ticksOf(frame.peak).flatMap((value) => [
    `<line x1="${num(frame.x0)}" x2="${num(frame.x1)}" y1="${num(yOf(frame, value))}" y2="${num(yOf(frame, value))}" stroke-width="1" stroke-opacity="0.6" ${paint(theme, { cls: `grid`, stroke: "rule" })}/>`,
    text(theme, { x: frame.x0 - 8, y: yOf(frame, value) + 4 }, String(value), { anchor: "end" }),
  ]),
  ...weeks.map((week, index) =>
    text(theme, { x: frame.xs[index] ?? 0, y: frame.y0 + 18 }, week.week.slice(-3), { anchor: "middle" }),
  ),
  `<line x1="${num(frame.x0)}" x2="${num(frame.x1)}" y1="${num(frame.y0)}" y2="${num(frame.y0)}" stroke-width="1" ${paint(theme, { stroke: "ink" })}/>`,
  text(theme, { x: 12, y: (frame.y0 + frame.y1) / 2 }, "concepts on record", {
    anchor: "middle",
    extra: `transform="rotate(-90 12 ${num((frame.y0 + frame.y1) / 2)})"`,
  }),
];

const curve = (points: readonly (readonly [number, number])[]): string =>
  points.reduce((path, [x, y], index) => {
    if (index === 0) return `M ${num(x)} ${num(y)}`;
    const [px, py] = points[index - 1] ?? [x, y];
    const mid = (px + x) / 2;
    return `${path} C ${num(mid)} ${num(py)}, ${num(mid)} ${num(y)}, ${num(x)} ${num(y)}`;
  }, "");

const workLine = (theme: ThemeChoice, frame: Frame, trajectory: DomainTrajectory): readonly string[] =>
  runsOf(trajectory.weeks, (week) => week.work !== null).flatMap((run) => {
    const points = run.map((index): [number, number] => [
      frame.xs[index] ?? 0,
      yOf(frame, trajectory.weeks[index]?.work ?? 0),
    ]);
    const dots = run.flatMap((index) => {
      const week = trajectory.weeks[index];
      if (week === undefined || markIn(trajectory.marks, week.week) !== undefined) return [];
      const band = landedIn(trajectory, week);
      const where = band === undefined ? "" : ` · landed in ${BANDS[band].label}`;
      return [
        `<circle cx="${num(frame.xs[index] ?? 0)}" cy="${num(yOf(frame, week.work ?? 0))}" r="3.2" ${paint(theme, { cls: `point`, fill: "you" })}><title>${escapeXml(`${week.week}${where}`)}</title></circle>`,
      ];
    });
    const line =
      points.length > 1
        ? [
            `<path d="${curve(points)}" stroke-width="2.6" stroke-linecap="round" ${paint(theme, { cls: `work`, stroke: "you" })}/>`,
          ]
        : [];
    return [...line, ...dots];
  });

const markTitle = (mark: Mark): string =>
  `${mark.kind} · ${mark.concept} · ${mark.evidence.map((item) => `${item.kind} ${item.task ?? "-"} ${item.file ?? "-"} ${item.at}`).join("; ")}`;

const markShape = (theme: ThemeChoice, mark: Mark, x: number, y: number): string =>
  mark.kind === "ricochet"
    ? `<circle cx="${num(x)}" cy="${num(y)}" r="6.5" stroke-width="2" ${paint(theme, { fill: "bg", stroke: "bInk" })}/><path d="M ${num(x - 3)} ${num(y - 3)} L ${num(x + 3)} ${num(y + 3)} M ${num(x + 3)} ${num(y - 3)} L ${num(x - 3)} ${num(y + 3)}" stroke-width="1.8" ${paint(theme, { stroke: "bInk" })}/>`
    : `<circle cx="${num(x)}" cy="${num(y)}" r="6.5" stroke-width="2" ${paint(theme, { fill: "bg", stroke: "iInk" })}/><circle cx="${num(x)}" cy="${num(y)}" r="2.6" ${paint(theme, { fill: "iInk" })}/>`;

const pointOf = (frame: Frame, weeks: readonly Week[], key: string | null): readonly [number, number] | undefined => {
  const index = weeks.findIndex((week) => week.week === key);
  const week = weeks[index];
  const level = week === undefined ? null : markLevel(week);
  return level === null ? undefined : [frame.xs[index] ?? 0, yOf(frame, level)];
};

const ricochetTrail = (
  theme: ThemeChoice,
  frame: Frame,
  weeks: readonly Week[],
  mark: Mark,
  at: readonly [number, number],
): string => {
  const [x, y] = at;
  const week = weeks.find((item) => item.week === mark.week);
  const from = pointOf(frame, weeks, mark.from);
  const arc =
    from === undefined || from[0] === x
      ? ""
      : `<path d="M ${num(from[0])} ${num(from[1])} Q ${num((from[0] + x) / 2)} ${num(Math.min(from[1], y) - 40)} ${num(x)} ${num(y)}" stroke-width="1.2" stroke-dasharray="3 3" ${paint(theme, { cls: `ricochet-arc`, stroke: "bInk" })}/>`;
  const drop = yOf(frame, week?.independent ?? 0);
  if (drop <= y + 7) return arc;
  const end = x > frame.x1 - 150;
  return `${arc}<line x1="${num(x)}" y1="${num(y + 7)}" x2="${num(x)}" y2="${num(drop)}" stroke-width="1.2" stroke-dasharray="1 3" ${paint(theme, { cls: `rebuild`, stroke: "bInk" })}/>${text(theme, { x: x + (end ? -6 : 6), y: drop - 4 }, "what the person rebuilds", { size: 10, fill: "bInk", anchor: end ? "end" : "start" })}`;
};

const marksOf = (
  theme: ThemeChoice,
  frame: Frame,
  trajectory: DomainTrajectory,
  selected: Mark | undefined,
): readonly string[] =>
  trajectory.marks.flatMap((mark) => {
    const at = pointOf(frame, trajectory.weeks, mark.week);
    if (at === undefined) return [];
    const ring =
      selected?.week === mark.week && selected.concept === mark.concept && selected.at === mark.at
        ? `<circle cx="${num(at[0])}" cy="${num(at[1])}" r="11" stroke-width="1.2" ${paint(theme, { cls: `selected`, stroke: "ink" })}/>`
        : "";
    const trail = mark.kind === "ricochet" ? ricochetTrail(theme, frame, trajectory.weeks, mark, at) : "";
    return [
      `${trail}<g class="mark-${mark.kind}">${ring}${markShape(theme, mark, at[0], at[1])}<title>${escapeXml(markTitle(mark))}</title></g>`,
    ];
  });

const shell = (theme: ThemeChoice, height: number, title: string, body: readonly string[]): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${String(SVG_WIDTH)}" height="${String(height)}" viewBox="0 0 ${String(SVG_WIDTH)} ${String(height)}" data-theme="${theme}" role="img"><title>${escapeXml(title)}</title>${styleOf(theme)}${defsOf(theme)}<rect width="${String(SVG_WIDTH)}" height="${String(height)}" ${paint(theme, { cls: `background`, fill: "bg" })}/>${body.join("")}</svg>`;

export const svgOf = (trajectory: DomainTrajectory, options: SvgOptions = {}): string => {
  const theme = options.theme ?? "auto";
  if (trajectory.status === "no_data")
    return shell(theme, 60, `${trajectory.domain}: no data`, [
      text(theme, { x: 8, y: 34 }, `${trajectory.domain}: no data (${String(trajectory.evidence)} weighted events)`, {
        size: 13,
        fill: "muted",
      }),
    ]);
  const frame = frameOf(trajectory);
  const title = `${trajectory.domain}: where accepted work landed per week across the bands, with ricochets marked`;
  return shell(theme, SVG_HEIGHT, title, [
    `<rect x="${num(frame.x0)}" y="${num(frame.y1)}" width="${num(frame.x1 - frame.x0)}" height="${num(frame.y0 - frame.y1)}" ${paint(theme, { cls: `plot`, fill: "h2" })}/>`,
    ...gapRects(theme, frame, trajectory.weeks),
    ...strataPaths(theme, frame, trajectory.weeks),
    ...axes(theme, frame, trajectory.weeks),
    keyOf(theme, frame, trajectory),
    ...workLine(theme, frame, trajectory),
    ...marksOf(theme, frame, trajectory, options.selected),
  ]);
};
