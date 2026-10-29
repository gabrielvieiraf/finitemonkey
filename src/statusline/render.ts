import type { Translate } from "../i18n/translate.js";
import type { GateLight } from "./gate-state.js";

export interface Segment {
  readonly task: string | undefined;
  readonly gate: GateLight;
  readonly contextPercent: number | undefined;
  readonly spend?: string;
  readonly fronts?: string | undefined;
  readonly hooksBroken?: boolean;
  readonly blueprint?: { readonly type: string; readonly green: number; readonly total: number } | undefined;
}

const SEPARATOR = " | ";

export const segmentText = (t: Translate, segment: Segment): string =>
  [
    "fm",
    ...(segment.task === undefined ? [] : [segment.task]),
    ...(segment.gate === "none" ? [] : [t(`statusline.gate.${segment.gate}`)]),
    ...(segment.hooksBroken === true ? [t("statusline.hooks_broken")] : []),
    ...(segment.fronts === undefined ? [] : [segment.fronts]),
    ...(segment.blueprint === undefined ? [] : [t("statusline.planta", { ...segment.blueprint })]),
    ...(segment.contextPercent === undefined ? [] : [t("statusline.context", { percent: segment.contextPercent })]),
    ...(segment.spend === undefined ? [] : [segment.spend]),
  ].join(" · ");

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");

const graphemes = (text: string): readonly string[] =>
  Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);

const fit = (line: string, columns: number | undefined): string => {
  if (columns === undefined) return line;
  const visible = graphemes(line.replace(ANSI, ""));
  return visible.length <= columns ? line : `${visible.slice(0, Math.max(0, columns - 1)).join("")}…`;
};

export const composeLine = (wrapped: string, segment: string, columns: number | undefined): string => {
  const lines = wrapped === "" ? [] : wrapped.split(/\r?\n/);
  const last = lines.pop();
  const joined = last === undefined || last.trim() === "" ? segment : `${last}${SEPARATOR}${segment}`;
  return [...lines, joined].map((line) => fit(line, columns)).join("\n");
};
