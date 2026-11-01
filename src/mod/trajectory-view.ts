import type { DomainTrajectory, Mark, Week } from "../conceitos/trajectory.js";
import { chartLines } from "../conceitos/trajectory-ansi.js";
import {
  bandAt,
  BANDS,
  describeBand,
  GROUP_LABEL,
  landedIn,
  markLevel,
  peakOf,
} from "../conceitos/trajectory-bands.js";
import { rasterOf, svgOf } from "../conceitos/trajectory-chart.js";
import type { ThemeChoice } from "../conceitos/trajectory-palette.js";
import type { Elements, ModElement, Surface } from "./api.js";

export { parseTrajectories } from "./trajectory-parse.js";

export const TRAJECTORY_PANE = "fm-trajectory";
const MAX_COLUMNS = 120;

export interface TrajectoryActions {
  readonly select: (mark: Mark) => Promise<void>;
  readonly close: () => Promise<void>;
}

export interface TrajectoryLook {
  readonly surface: Surface;
  readonly columns: number;
  readonly theme: ThemeChoice;
}

const glyph = (mark: Mark): string => (mark.kind === "ricochet" ? "✕" : "◉");

const sameMark = (a: Mark | undefined, b: Mark): boolean =>
  a?.week === b.week && a.concept === b.concept && a.at === b.at;

export const CAPTION =
  "Each column is a week. Strata show where the record puts each concept: done alone, judged (prediction or check right), the unstable boundary, the blind band split by criterion, and beyond the horizon. The amber line is where accepted work landed; ✕ is a ricochet, ◉ held. Hatched columns are weeks with no evidence. Sub-bands the record does not hold are listed as hypotheses and not drawn.";

const markText = (mark: Mark): string =>
  mark.kind === "ricochet"
    ? "A hunk accepted without evidence of judgment broke later and the fix did not come from the person."
    : "A hunk broke later and the person made the fix.";

export const evidenceLines = (mark: Mark, trajectory?: DomainTrajectory): readonly string[] => {
  const week = trajectory?.weeks.find((item) => item.week === mark.week);
  const level = week === undefined ? null : markLevel(week);
  const band =
    week === undefined || level === null || trajectory === undefined
      ? undefined
      : bandAt(week, level, peakOf(trajectory));
  return [
    `${glyph(mark)} ${mark.kind} · ${mark.concept} · ${mark.week}`,
    markText(mark),
    ...(band === undefined ? [] : [`zone: ${GROUP_LABEL[BANDS[band].group]} · sub-band: ${BANDS[band].label}`]),
    ...(mark.from === null ? [] : [`accepted in ${mark.from}`]),
    ...mark.evidence.map(
      (item) =>
        `  evidence: ${item.kind} · task ${item.task ?? "-"} · ${item.file ?? "-"} · ${item.at.slice(0, 16).replace("T", " ")}`,
    ),
  ];
};

const span = (from: number | null, to: number | null): string =>
  from === null || to === null ? "-" : `${String(from)}-${String(to)}`;

const weekRow = (trajectory: DomainTrajectory, week: Week): string => {
  if (week.assisted === null) return `${week.week.slice(-3)}  no evidence`;
  const band = landedIn(trajectory, week);
  const marks = trajectory.marks.filter((mark) => mark.week === week.week);
  return [
    week.week.slice(-3),
    (band === undefined ? "no accepted work" : describeBand(band)).padEnd(38),
    span(week.independent, week.discernment).padEnd(7),
    span(week.discernment, week.assisted).padEnd(7),
    marks.length === 0 ? "-" : marks.map((mark) => `${glyph(mark)} ${mark.kind} ${mark.concept}`).join(", "),
  ].join("  ");
};

export const weekLines = (trajectory: DomainTrajectory): readonly string[] => [
  `week ${"work landed in".padEnd(38)}  ${"proximal".padEnd(7)}  ${"blind".padEnd(7)}  event`,
  ...trajectory.weeks.map((week) => weekRow(trajectory, week)),
];

export const trajectoryText = (domains: readonly DomainTrajectory[]): string =>
  chartLines(domains, { depth: "none", theme: "dark" }).join("\n");

const chartOf = (
  elements: Elements,
  item: DomainTrajectory,
  look: TrajectoryLook,
  selected: Mark | undefined,
): ModElement => {
  const raster = elements.Raster;
  const svg = elements.Svg;
  if (look.surface === "terminal" && raster !== undefined) {
    const theme = look.theme === "light" ? "light" : "dark";
    const cells = rasterOf(item, Math.max(40, Math.min(look.columns, MAX_COLUMNS)), {
      theme,
      ...(selected === undefined ? {} : { selected }),
    });
    return raster({ key: `fm-trajectory-raster-${item.domain}`, ...cells });
  }
  if (look.surface !== "terminal" && svg !== undefined)
    return svg({
      key: `fm-trajectory-svg-${item.domain}`,
      source: svgOf(item, { theme: look.theme, ...(selected === undefined ? {} : { selected }) }),
      alt: `${item.domain}: where accepted work landed per week across the bands, with ricochets marked`,
      isInteractive: true,
    });
  return elements.Text({ key: `fm-trajectory-text-${item.domain}`, children: [trajectoryText([item])] });
};

const markButtons = (
  elements: Elements,
  item: DomainTrajectory,
  selected: Mark | undefined,
  actions: TrajectoryActions,
): readonly ModElement[] =>
  item.marks.length === 0
    ? []
    : [
        elements.Box({
          key: `fm-trajectory-marks-${item.domain}`,
          flexDirection: "row",
          columnGap: 2,
          children: item.marks.map((mark, index) =>
            elements.Button({
              key: `fm-trajectory-mark-${item.domain}-${String(index)}`,
              label: `${sameMark(selected, mark) ? "▸ " : ""}${glyph(mark)} ${mark.week.slice(-3)} ${mark.concept} ${mark.kind}`,
              onPress: () => actions.select(mark),
            }),
          ),
        }),
      ];

const detailOf = (elements: Elements, item: DomainTrajectory, selected: Mark | undefined): readonly ModElement[] => {
  const mark = item.marks.find((candidate) => sameMark(selected, candidate));
  if (mark === undefined) return [];
  return evidenceLines(mark, item).map((line, index) =>
    elements.Text({
      key: `fm-trajectory-evidence-${item.domain}-${String(index)}`,
      bold: index === 0,
      children: [line],
    }),
  );
};

const domainOf = (
  elements: Elements,
  item: DomainTrajectory,
  selected: Mark | undefined,
  look: TrajectoryLook,
  actions: TrajectoryActions,
): readonly ModElement[] => {
  if (item.status !== "ok")
    return [
      elements.Text({
        key: `fm-trajectory-head-${item.domain}`,
        dimColor: true,
        children: [`${item.domain}: no data (${String(item.evidence)} weighted events)`],
      }),
    ];
  const first = item.weeks[0]?.week ?? "";
  const last = item.weeks.at(-1)?.week ?? "";
  return [
    elements.Text({
      key: `fm-trajectory-head-${item.domain}`,
      bold: true,
      children: [`Trajectory · ${item.domain} · ${first} to ${last} · ${String(item.evidence)} weighted events`],
    }),
    chartOf(elements, item, look, selected),
    elements.Text({ key: `fm-trajectory-events-head-${item.domain}`, bold: true, children: ["Events"] }),
    ...markButtons(elements, item, selected, actions),
    ...detailOf(elements, item, selected),
    ...weekLines(item).map((line, index) =>
      elements.Text({
        key: `fm-trajectory-week-${item.domain}-${String(index)}`,
        dimColor: index === 0,
        children: [line],
      }),
    ),
  ];
};

export const trajectoryTree = (
  elements: Elements,
  domains: readonly DomainTrajectory[],
  selected: Mark | undefined,
  look: TrajectoryLook,
  actions: TrajectoryActions,
): ModElement =>
  elements.Box({
    key: "fm-trajectory",
    flexDirection: "column",
    children: [
      ...domains.flatMap((item) => domainOf(elements, item, selected, look, actions)),
      elements.Text({ key: "fm-trajectory-caption", dimColor: true, children: [CAPTION] }),
      elements.Button({ key: "fm-trajectory-close", label: "Close", hotkey: "x", onPress: actions.close }),
    ],
  });
