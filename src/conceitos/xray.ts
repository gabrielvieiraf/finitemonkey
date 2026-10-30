import { basename, extname } from "node:path";

import type { AddedLine } from "../gate/git.js";
import type { ConceptId } from "./concepts.js";
import { conceptsOfFile, type ConceptState } from "./evidence.js";

export const XRAY_SCHEMA = "finitemonkey/xray@1";
export const XRAY_FEATURE = "xray";
export const BANDS = ["beyond", "unknown", "edge", "within"] as const;
export const COVERAGES = ["none", "decorative", "covered"] as const;

export type Band = (typeof BANDS)[number];
export type Coverage = (typeof COVERAGES)[number];
export type CriterionKind = "example" | "check" | "scenario" | "tests";

export interface XrayHunk {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly lines: readonly string[];
}

export interface CriterionRef {
  readonly id: string;
  readonly kind: CriterionKind;
  readonly mentions: readonly string[];
  readonly decorative: boolean;
}

export interface XrayItem {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly by: "agent" | "person";
  readonly concepts: readonly { readonly concept: ConceptId; readonly state: ConceptState }[];
  readonly band: Band;
  readonly coverage: Coverage;
  readonly criteria: readonly string[];
  readonly criterion: CriterionKind | null;
}

export type Grid = Readonly<Record<Band, Readonly<Record<Coverage, number>>>>;

export interface Xray {
  readonly items: readonly XrayItem[];
  readonly grid: Grid;
  readonly beyondWithoutCriterion: number;
}

export const hunksOf = (added: readonly AddedLine[]): readonly XrayHunk[] => {
  const hunks: { file: string; start: number; end: number; lines: string[] }[] = [];
  for (const line of added) {
    const last = hunks.at(-1);
    if (last?.file === line.path && line.line === last.end + 1) {
      last.end = line.line;
      last.lines.push(line.text);
    } else hunks.push({ file: line.path, start: line.line, end: line.line, lines: [line.text] });
  }
  return hunks;
};

const RANK: Readonly<Record<ConceptState, number>> = { demonstrated: 0, proximal: 1, unknown: 2, beyond: 3 };

export const bandOf = (states: readonly ConceptState[]): Band => {
  if (states.length === 0) return "unknown";
  const worst = states.reduce((top, state) => (RANK[state] > RANK[top] ? state : top), "demonstrated");
  if (worst === "beyond") return "beyond";
  if (worst === "unknown") return "unknown";
  return worst === "proximal" ? "edge" : "within";
};

export const stemOf = (file: string): string => basename(file, extname(file));

const mentionsFile = (ref: CriterionRef, file: string): boolean => {
  const stem = stemOf(file);
  return ref.mentions.some(
    (text) => text.includes(file) || (stem.length >= 3 && new RegExp(`(^|[^\\w-])${stem}([^\\w-]|$)`).test(text)),
  );
};

export interface CoverageOf {
  readonly coverage: Coverage;
  readonly criteria: readonly string[];
  readonly criterion: CriterionKind | null;
}

export const coverageOf = (file: string, refs: readonly CriterionRef[]): CoverageOf => {
  const hits = refs.filter((ref) => mentionsFile(ref, file));
  if (hits.length === 0) return { coverage: "none", criteria: [], criterion: null };
  const strong = hits.filter((ref) => !ref.decorative);
  const chosen = strong.length > 0 ? strong : hits;
  return {
    coverage: strong.length > 0 ? "covered" : "decorative",
    criteria: chosen.map((ref) => ref.id),
    criterion: chosen[0]?.kind ?? null,
  };
};

const emptyGrid = (): Record<Band, Record<Coverage, number>> => ({
  beyond: { none: 0, decorative: 0, covered: 0 },
  unknown: { none: 0, decorative: 0, covered: 0 },
  edge: { none: 0, decorative: 0, covered: 0 },
  within: { none: 0, decorative: 0, covered: 0 },
});

export interface XrayInput {
  readonly added: readonly AddedLine[];
  readonly states: ReadonlyMap<ConceptId, ConceptState>;
  readonly refs: readonly CriterionRef[];
  readonly agentFiles: ReadonlySet<string>;
}

const order = (item: XrayItem): number => BANDS.indexOf(item.band) * 3 + COVERAGES.indexOf(item.coverage);

export const xrayOf = (input: XrayInput): Xray => {
  const items = hunksOf(input.added).map((hunk): XrayItem => {
    const concepts = conceptsOfFile(hunk.file, hunk.lines).map((concept) => ({
      concept,
      state: input.states.get(concept) ?? "unknown",
    }));
    const { coverage, criteria, criterion } = coverageOf(hunk.file, input.refs);
    return {
      file: hunk.file,
      start: hunk.start,
      end: hunk.end,
      by: input.agentFiles.has(hunk.file) ? "agent" : "person",
      concepts,
      band: bandOf(concepts.map((item) => item.state)),
      coverage,
      criteria,
      criterion,
    };
  });
  const grid = emptyGrid();
  for (const item of items) grid[item.band][item.coverage] += 1;
  return {
    items: [...items].sort((a, b) => order(a) - order(b) || a.file.localeCompare(b.file) || a.start - b.start),
    grid,
    beyondWithoutCriterion: grid.beyond.none,
  };
};
