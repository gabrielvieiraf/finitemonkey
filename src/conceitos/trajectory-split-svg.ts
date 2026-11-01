import type { Week } from "./trajectory.js";
import { describeSplit, splitAt } from "./trajectory-bands.js";
import { GROUP_INK, type Plot, yOf } from "./trajectory-key.js";
import { escapeXml, num, paint } from "./trajectory-paint.js";
import type { ThemeChoice } from "./trajectory-palette.js";
import { SPLIT_GROUPS, type SplitGroup } from "./trajectory-split-types.js";

export interface SplitFrame extends Plot {
  readonly xs: readonly number[];
  readonly half: number;
}

const runsOf = (levels: readonly (number | undefined)[]): readonly (readonly number[])[] =>
  levels.reduce<number[][]>((runs, level, index) => {
    if (level === undefined) return runs;
    const last = runs.at(-1);
    if (last?.at(-1) === index - 1) last.push(index);
    else runs.push([index]);
    return runs;
  }, []);

const pointsOf = (frame: SplitFrame, run: readonly number[], levels: readonly (number | undefined)[]) =>
  run.flatMap((index) => {
    const x = frame.xs[index] ?? 0;
    const y = yOf(frame, levels[index] ?? 0);
    return run.length === 1
      ? [`${num(x - frame.half * 0.8)} ${num(y)}`, `${num(x + frame.half * 0.8)} ${num(y)}`]
      : [`${num(x)} ${num(y)}`];
  });

const groupPaths = (theme: ThemeChoice, frame: SplitFrame, weeks: readonly Week[], group: SplitGroup) => {
  const levels = weeks.map((week) => splitAt(week, group, frame.peak));
  return runsOf(levels).map(
    (run) =>
      `<path d="M ${pointsOf(frame, run, levels).join(" L ")}" stroke-width="1" stroke-dasharray="4 3" ${paint(theme, { cls: `split split-${group}`, stroke: GROUP_INK[group] })}><title>${escapeXml(`${describeSplit(group)} · calibration`)}</title></path>`,
  );
};

export const splitPaths = (theme: ThemeChoice, frame: SplitFrame, weeks: readonly Week[]): readonly string[] =>
  SPLIT_GROUPS.flatMap((group) => groupPaths(theme, frame, weeks, group));
