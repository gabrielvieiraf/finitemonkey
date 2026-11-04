import type { EventEntry } from "../judge/types.js";
import { type Domain, DOMAINS } from "../perfil/types.js";
import type { DomainTrajectory } from "./trajectory.js";
import { escapeXml, num, paint } from "./trajectory-paint.js";
import type { ThemeChoice } from "./trajectory-palette.js";

export const RESEARCH_FIXES = ["open", "revert", "agent", "person"] as const;

export type ResearchFix = (typeof RESEARCH_FIXES)[number];

export interface ResearchMark {
  readonly week: string;
  readonly at: string;
  readonly event: string;
  readonly claim: string;
  readonly cause: string;
  readonly fix: ResearchFix;
  readonly commit: string | null;
  readonly field: string;
  readonly concepts: readonly string[];
}

export const fixOf = (event: Pick<EventEntry, "fixedBy" | "state">): ResearchFix => {
  if (event.fixedBy === "revert" || event.fixedBy === "agent" || event.fixedBy === "person") return event.fixedBy;
  return event.state === "held" ? "person" : "open";
};

export const codeDomain = (field: string): Domain | undefined => DOMAINS.find((domain) => domain === field);

export interface WithResearch {
  readonly domains: readonly DomainTrajectory[];
  readonly outside: readonly ResearchMark[];
}

export const withResearch = (
  domains: readonly DomainTrajectory[],
  marks: readonly ResearchMark[],
  weeks: readonly string[],
): WithResearch => ({
  domains: domains.map((item) => {
    const mine = marks.filter((mark) => mark.field === item.domain && weeks.includes(mark.week));
    return item.status === "ok" && mine.length > 0 ? { ...item, research: mine } : item;
  }),
  outside: marks.filter(
    (mark) =>
      codeDomain(mark.field) === undefined &&
      !domains.some((item) => item.domain === mark.field && item.status === "ok") &&
      weeks.includes(mark.week),
  ),
});

export const RESEARCH_GLYPH: Readonly<Record<ResearchFix, string>> = {
  open: "▲",
  revert: "↺",
  agent: "◇",
  person: "◆",
};

export const RESEARCH_PLAIN: Readonly<Record<string, string>> = { "▲": "^", "↺": "R", "◇": "a", "◆": "P" };

const RANK: Readonly<Record<ResearchFix, number>> = { open: 0, revert: 1, agent: 2, person: 3 };

export const weekFix = (marks: readonly ResearchMark[], week: string): ResearchFix | undefined =>
  marks
    .filter((mark) => mark.week === week)
    .map((mark) => mark.fix)
    .sort((a, b) => RANK[a] - RANK[b])[0];

export const researchLane = (weeks: readonly string[], marks: readonly ResearchMark[], perWeek: number): string =>
  weeks
    .map((week) => {
      const fix = weekFix(marks, week);
      return (fix === undefined ? " " : RESEARCH_GLYPH[fix]).padEnd(perWeek);
    })
    .join("");

const shapeOf = (theme: ThemeChoice, fix: ResearchFix, x: number, y: number): string => {
  const diamond = `M ${num(x)} ${num(y - 6)} L ${num(x + 6)} ${num(y)} L ${num(x)} ${num(y + 6)} L ${num(x - 6)} ${num(y)} Z`;
  if (fix === "open")
    return `<path d="M ${num(x)} ${num(y - 6)} L ${num(x + 6)} ${num(y + 5)} L ${num(x - 6)} ${num(y + 5)} Z" stroke-width="1.8" ${paint(theme, { fill: "bg", stroke: "bInk" })}/>`;
  if (fix === "revert")
    return `<rect x="${num(x - 5)}" y="${num(y - 5)}" width="10" height="10" stroke-width="1.8" stroke-dasharray="2 2" ${paint(theme, { fill: "bg", stroke: "bInk" })}/>`;
  if (fix === "agent")
    return `<path d="${diamond}" stroke-width="1.8" ${paint(theme, { fill: "bg", stroke: "ink" })}/>`;
  return `<path d="${diamond}" ${paint(theme, { fill: "iInk" })}/>`;
};

const titleOf = (mark: ResearchMark): string =>
  `research ${mark.cause} · ${mark.claim} · ${mark.fix === "open" ? "open" : `fixed by ${mark.fix}`}${mark.commit === null ? "" : ` in ${mark.commit}`} · ${mark.at}`;

export const researchSvg = (
  theme: ThemeChoice,
  lane: { readonly xs: readonly number[]; readonly weeks: readonly string[]; readonly y: number },
  marks: readonly ResearchMark[],
): readonly string[] =>
  marks.flatMap((mark) => {
    const index = lane.weeks.indexOf(mark.week);
    const x = lane.xs[index];
    if (index < 0 || x === undefined) return [];
    const offset = marks.filter((item) => item.week === mark.week).indexOf(mark) * 14;
    return [
      `<g class="research-${mark.fix}">${shapeOf(theme, mark.fix, x + offset, lane.y)}<title>${escapeXml(titleOf(mark))}</title></g>`,
    ];
  });
