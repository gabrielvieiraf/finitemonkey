import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { lineCount, tokenEstimate } from "../instructions/types.js";
import { policyNumber } from "../policy/numbers.js";

export const DEFAULT_BLOCK_MAX_LINES = 30;
export const DEFAULT_BLOCK_MAX_TOKENS = 400;

export const OVERVIEW_HEADING =
  /^#{1,6}\s+.*\b(?:overview|summary|architecture|about|introduction|structure|vis[ãa]o geral|resumo|arquitetura|resumen|arquitectura|estructura)\b/iu;

export interface BlockLimits {
  readonly maxLines: number;
  readonly maxTokens: number;
}

export interface BlockSection {
  readonly heading: string;
  readonly intro: readonly string[];
  readonly rows: readonly string[];
}

export interface FittedBlock {
  readonly lines: readonly string[];
  readonly dropped: number;
}

export const blockLimits = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): BlockLimits => ({
  maxLines: policyNumber(runtime, root, ["knowledge", "blockMaxLines"], DEFAULT_BLOCK_MAX_LINES),
  maxTokens: policyNumber(runtime, root, ["knowledge", "blockMaxTokens"], DEFAULT_BLOCK_MAX_TOKENS),
});

const render = (sections: readonly BlockSection[]): readonly string[] =>
  sections
    .filter((section) => section.rows.length > 0 || section.intro.length > 0)
    .flatMap((section, index) => [
      ...(index === 0 ? [] : [""]),
      section.heading,
      "",
      ...section.intro,
      ...section.rows,
    ]);

export const fits = (lines: readonly string[], limits: BlockLimits): boolean => {
  const text = lines.join("\n");
  return lineCount(`${text}\n`) <= limits.maxLines && tokenEstimate(text) <= limits.maxTokens;
};

const withoutOverview = (section: BlockSection): BlockSection => ({
  heading: section.heading,
  intro: section.intro.filter((line) => !OVERVIEW_HEADING.test(line)),
  rows: section.rows.filter((line) => !OVERVIEW_HEADING.test(line)),
});

export const fitBlock = (sections: readonly BlockSection[], limits: BlockLimits): FittedBlock => {
  const kept = sections.filter((section) => !OVERVIEW_HEADING.test(section.heading)).map(withoutOverview);
  const total = kept.reduce((sum, section) => sum + section.rows.length, 0);
  let current = kept;
  let dropped = 0;
  while (!fits(render(current), limits)) {
    const last = current.findLastIndex((section) => section.rows.length > 0);
    if (last < 0) return { lines: [], dropped: total };
    current = current.map((section, index) =>
      index === last ? { ...section, rows: section.rows.slice(0, -1) } : section,
    );
    dropped += 1;
  }
  return { lines: render(current), dropped };
};

export interface BlockDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

export const blockDiff = (before: readonly string[], after: readonly string[]): BlockDiff => {
  const left = new Set(before);
  const right = new Set(after);
  return {
    added: after.filter((line) => line.trim() !== "" && !left.has(line)),
    removed: before.filter((line) => line.trim() !== "" && !right.has(line)),
  };
};
