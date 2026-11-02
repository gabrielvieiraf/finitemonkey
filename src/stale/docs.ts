import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { matchesAny } from "../core/glob.js";
import type { Runtime } from "../core/runtime.js";

export const DOC_PATTERNS: readonly string[] = [
  "README*.md",
  "AGENTS.md",
  "CONTRIBUTING*.md",
  "CHANGELOG*.md",
  "SECURITY*.md",
  "docs/**/*.md",
];

export interface DocUnit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface ClaimUnit {
  readonly text: string;
  readonly scope: string;
}

const FENCE = /^\s*(?:```|~~~)/;
const CLAUSE_END = /(?<=[.;!?])\s+(?=[A-Z*`(\u00c0-\u00dd])|;\s+|,\s+(?:but|and|mas|e|pero|y)\s+/;
const STATUS_CELL_WORDS = 5;

export const docFiles = (runtime: Pick<Runtime, "git">, root: AbsolutePath): readonly string[] => {
  const listed = runtime.git(["ls-files", "-z", "--", "*.md"], root);
  if (!listed.ok) return [];
  return listed.stdout
    .split("\0")
    .filter((path) => path !== "" && matchesAny(path, DOC_PATTERNS))
    .sort();
};

const cellsOf = (row: string): readonly string[] =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim())
    .filter((cell) => cell !== "");

const words = (text: string): number =>
  text
    .replace(/[*_()`]/g, " ")
    .trim()
    .split(/\s+/).length;

const clausesOf = (text: string): readonly ClaimUnit[] =>
  text
    .split(CLAUSE_END)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== "")
    .map((piece) => ({ text: piece, scope: piece }));

export const claimUnits = (line: string, isStatus: (text: string) => boolean): readonly ClaimUnit[] => {
  if (!line.trimStart().startsWith("|")) return clausesOf(line);
  return cellsOf(line).flatMap((cell) =>
    words(cell) <= STATUS_CELL_WORDS && isStatus(cell) ? [{ text: cell, scope: line }] : clausesOf(cell),
  );
};

export const unitsOf = (file: string, text: string): readonly DocUnit[] => {
  const units: DocUnit[] = [];
  let fenced = false;
  text.split("\n").forEach((line, index) => {
    if (FENCE.test(line)) {
      fenced = !fenced;
      return;
    }
    if (!fenced && line.trim() !== "" && !/^\s*\|[\s:|-]+\|?\s*$/.test(line))
      units.push({ file, line: index + 1, text: line.trim() });
  });
  return units;
};

export const readUnits = (
  runtime: Pick<Runtime, "git" | "readText">,
  root: AbsolutePath,
  files: readonly string[] = docFiles(runtime, root),
): readonly DocUnit[] =>
  files.flatMap((file) => {
    const read = runtime.readText(toAbsolutePath(file, root));
    return read.ok ? unitsOf(file, read.value) : [];
  });
