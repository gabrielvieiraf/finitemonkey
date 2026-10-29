import type { DomainTrajectory, Mark, Week } from "./trajectory.js";

export type Zone = "independent" | "proximal" | "blindCovered" | "blindBare" | "beyond";

export const ZONE_LABEL: Readonly<Record<Zone, string>> = {
  independent: "done alone",
  proximal: "proximal band",
  blindCovered: "blind band, with criterion",
  blindBare: "blind band, no criterion",
  beyond: "beyond the horizon",
};

const ZONE_GLYPH: Readonly<Record<Zone, string>> = {
  independent: "█",
  proximal: "▓",
  blindCovered: "▒",
  blindBare: "░",
  beyond: " ",
};

const ZONE_COLOR: Readonly<Record<Zone, number>> = {
  independent: 0x2f7d4f,
  proximal: 0xc28a1a,
  blindCovered: 0x6a5acd,
  blindBare: 0xa0463a,
  beyond: 0x1000000,
};

const ACCENT = 0xf5b041;
const RICOCHET = 0xff453a;
const HELD = 0x34c759;
const DEFAULT = 0x1000000;

const blindSplit = (week: Week, discernment: number, assisted: number): number => {
  const helps = week.blindCovered + week.blindBare;
  return helps === 0 ? discernment : discernment + ((assisted - discernment) * week.blindCovered) / helps;
};

export const zoneAt = (week: Week, level: number): Zone | undefined => {
  if (week.independent === null || week.discernment === null || week.assisted === null) return undefined;
  if (level <= week.independent) return "independent";
  if (level <= week.discernment) return "proximal";
  if (level <= week.assisted)
    return level <= blindSplit(week, week.discernment, week.assisted) ? "blindCovered" : "blindBare";
  return "beyond";
};

const markOf = (marks: readonly Mark[], week: string): Mark | undefined => {
  const here = marks.filter((mark) => mark.week === week);
  return here.find((mark) => mark.kind === "ricochet") ?? here[0];
};

export const cellOf = (trajectory: DomainTrajectory, week: Week): string => {
  const mark = markOf(trajectory.marks, week.week);
  if (mark !== undefined) return mark.kind === "ricochet" ? "↯" : "●";
  if (week.assisted === null) return "·";
  if (week.work === null) return "-";
  const zone = zoneAt(week, week.work);
  return zone === undefined ? "·" : ZONE_GLYPH[zone] === " " ? "^" : ZONE_GLYPH[zone];
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
    "█ done alone  ▓ proximal  ▒ blind with criterion  ░ blind without  ^ beyond  ↯ ricochet  ● held  - no accepted work  · no evidence",
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

const top = (trajectory: DomainTrajectory): number =>
  Math.max(
    1,
    ...trajectory.weeks.map((week) => (week.assisted ?? 0) + 1),
    ...trajectory.weeks.map((week) => week.work ?? 0),
  );

export const blockLines = (trajectory: DomainTrajectory, rows = 6): readonly string[] => {
  if (trajectory.status === "no_data")
    return [`${trajectory.domain}: no data (${String(trajectory.evidence)} weighted events)`];
  const peak = top(trajectory);
  const lines = Array.from({ length: rows }, (_, row) => {
    const level = (peak * (rows - row)) / rows;
    const cells = trajectory.weeks.map((week) => {
      if (week.assisted === null) return "·";
      const onLine = week.work !== null && Math.abs(week.work - level) < peak / rows / 2;
      if (onLine) return "━";
      return ZONE_GLYPH[zoneAt(week, level) ?? "beyond"];
    });
    const zone = [...trajectory.weeks]
      .reverse()
      .map((week) => zoneAt(week, level))
      .find((item) => item !== undefined);
    return `${cells.join("")}  ${zone === undefined ? "" : ZONE_LABEL[zone]}`;
  });
  const marks = trajectory.weeks.map((week) => {
    const mark = markOf(trajectory.marks, week.week);
    return mark === undefined ? " " : mark.kind === "ricochet" ? "↯" : "●";
  });
  return [trajectory.domain, marks.join(""), ...lines];
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

export interface RasterCell {
  readonly glyph: string;
  readonly fg: number;
  readonly bg: number;
}

export const rasterCells = (trajectory: DomainTrajectory, columns: number, rows: number): readonly RasterCell[] => {
  const peak = top(trajectory);
  const weeks = trajectory.weeks;
  const cells: RasterCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const week = weeks[Math.min(weeks.length - 1, Math.floor((column * weeks.length) / Math.max(columns, 1)))];
      if (week === undefined) {
        cells.push({ glyph: " ", fg: DEFAULT, bg: DEFAULT });
        continue;
      }
      if (row === 0) {
        const mark = markOf(trajectory.marks, week.week);
        cells.push(
          mark === undefined
            ? { glyph: " ", fg: DEFAULT, bg: DEFAULT }
            : {
                glyph: mark.kind === "ricochet" ? "↯" : "●",
                fg: mark.kind === "ricochet" ? RICOCHET : HELD,
                bg: DEFAULT,
              },
        );
        continue;
      }
      const level = (peak * (rows - row)) / (rows - 1);
      if (week.assisted === null) {
        cells.push({ glyph: "·", fg: DEFAULT, bg: DEFAULT });
        continue;
      }
      const zone = zoneAt(week, level) ?? "beyond";
      const onLine = week.work !== null && Math.abs(week.work - level) < peak / (rows - 1) / 2;
      cells.push({ glyph: onLine ? "━" : " ", fg: onLine ? ACCENT : DEFAULT, bg: ZONE_COLOR[zone] });
    }
  }
  return cells;
};

export const rasterOf = (
  trajectory: DomainTrajectory,
  columns: number,
  rows: number,
): { readonly columns: number; readonly rows: number; readonly cells: string } => {
  const bytes = rasterCells(trajectory, columns, rows).flatMap((cell) => [
    ...word(cell.glyph.codePointAt(0) ?? 32),
    ...word(cell.fg),
    ...word(cell.bg),
  ]);
  return { columns, rows, cells: base64(bytes) };
};

const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const SVG_FILL: Readonly<Record<Zone, string>> = {
  independent: "#2f7d4f",
  proximal: "#c28a1a",
  blindCovered: "#6a5acd",
  blindBare: "#a0463a",
  beyond: "none",
};

interface Frame {
  readonly pad: number;
  readonly plotWidth: number;
  readonly plotHeight: number;
  readonly step: number;
  readonly peak: number;
}

const yOf = (frame: Frame, level: number): number =>
  frame.pad + frame.plotHeight - (level / frame.peak) * frame.plotHeight;

const xOf = (frame: Frame, index: number): number => frame.pad + index * frame.step;

const zoneRects = (frame: Frame, week: Week, index: number): readonly string[] => {
  const x = String(xOf(frame, index));
  if (week.independent === null || week.discernment === null || week.assisted === null)
    return [
      `<rect class="gap" x="${x}" y="${String(frame.pad)}" width="${String(frame.step)}" height="${String(frame.plotHeight)}" fill="url(#gap)"><title>${escape(`${week.week}: no evidence`)}</title></rect>`,
    ];
  const split = blindSplit(week, week.discernment, week.assisted);
  const bands: readonly [Zone, number, number][] = [
    ["independent", 0, week.independent],
    ["proximal", week.independent, week.discernment],
    ["blindCovered", week.discernment, split],
    ["blindBare", split, week.assisted],
  ];
  return bands
    .filter(([, from, to]) => to > from)
    .map(
      ([zone, from, to]) =>
        `<rect class="zone-${zone}" x="${x}" y="${String(yOf(frame, to))}" width="${String(frame.step)}" height="${String(yOf(frame, from) - yOf(frame, to))}" fill="${SVG_FILL[zone]}" fill-opacity="0.55"/>`,
    );
};

const workLines = (frame: Frame, weeks: readonly Week[]): readonly string[] => {
  const segments: string[][] = [];
  weeks.forEach((week, index) => {
    if (week.work === null) {
      segments.push([]);
      return;
    }
    const point = `${String(xOf(frame, index) + frame.step / 2)},${String(yOf(frame, week.work))}`;
    const current = segments.at(-1);
    if (current === undefined) segments.push([point]);
    else current.push(point);
  });
  return segments
    .filter((item) => item.length > 0)
    .map(
      (points) =>
        `<polyline class="work" points="${points.join(" ")}" fill="none" stroke="#f5b041" stroke-width="2.5"/>`,
    );
};

const markTexts = (frame: Frame, trajectory: DomainTrajectory): readonly string[] =>
  trajectory.marks.flatMap((mark) => {
    const index = trajectory.weeks.findIndex((week) => week.week === mark.week);
    if (index < 0) return [];
    const evidence = mark.evidence
      .map((item) => `${item.kind} ${item.task ?? "-"} ${item.file ?? "-"} ${item.at}`)
      .join("; ");
    const color = mark.kind === "ricochet" ? "#ff453a" : "#34c759";
    return [
      `<text class="mark-${mark.kind}" x="${String(xOf(frame, index) + frame.step / 2)}" y="${String(frame.pad - 6)}" text-anchor="middle" font-size="14" fill="${color}">${mark.kind === "ricochet" ? "↯" : "●"}<title>${escape(`${mark.kind} · ${mark.concept} · ${evidence}`)}</title></text>`,
    ];
  });

const zoneLabels = (frame: Frame, weeks: readonly Week[]): readonly string[] => {
  const last = [...weeks].reverse().find((week) => week.assisted !== null);
  const independent = last?.independent ?? null;
  const discernment = last?.discernment ?? null;
  const assisted = last?.assisted ?? null;
  if (independent === null || discernment === null || assisted === null) return [];
  const labels: readonly [string, number][] = [
    [ZONE_LABEL.independent, independent / 2],
    [ZONE_LABEL.proximal, (independent + discernment) / 2],
    ["blind band", (discernment + assisted) / 2],
    [ZONE_LABEL.beyond, (assisted + frame.peak) / 2],
  ];
  return labels.map(
    ([label, level]) =>
      `<text x="${String(frame.pad + frame.plotWidth + 8)}" y="${String(yOf(frame, level) + 4)}" font-size="11" fill="currentColor">${escape(label)}</text>`,
  );
};

export const svgOf = (trajectory: DomainTrajectory, width = 640, height = 240): string => {
  if (trajectory.status === "no_data")
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="60" viewBox="0 0 ${String(width)} 60"><text x="8" y="30" font-size="13" fill="currentColor">${escape(`${trajectory.domain}: no data (${String(trajectory.evidence)} weighted events)`)}</text></svg>`;
  const weeks = trajectory.weeks;
  const plotWidth = width - 180;
  const frame: Frame = {
    pad: 24,
    plotWidth,
    plotHeight: height - 48,
    step: plotWidth / Math.max(weeks.length, 1),
    peak: top(trajectory),
  };
  const caption = `${trajectory.domain} · ${String(trajectory.evidence)} weighted events · ${weeks[0]?.week ?? ""} to ${weeks.at(-1)?.week ?? ""}`;
  const parts = [
    `<defs><pattern id="gap" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" stroke-opacity="0.35"/></pattern></defs>`,
    ...weeks.flatMap((week, index) => zoneRects(frame, week, index)),
    ...workLines(frame, weeks),
    ...markTexts(frame, trajectory),
    ...zoneLabels(frame, weeks),
    `<text x="${String(frame.pad)}" y="${String(height - 4)}" font-size="11" fill="currentColor">${escape(caption)}</text>`,
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}">${parts.join("")}</svg>`;
};
