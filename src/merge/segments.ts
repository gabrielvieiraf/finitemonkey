export interface CleanSegment {
  readonly kind: "clean";
  readonly lines: readonly string[];
}

export interface ConflictSegment {
  readonly kind: "conflict";
  readonly ours: readonly string[];
  readonly base: readonly string[];
  readonly theirs: readonly string[];
}

export type Segment = CleanSegment | ConflictSegment;

export const MARKER_SIZE = 15;

const marker = (char: string): string => char.repeat(MARKER_SIZE);

type Section = "clean" | "ours" | "base" | "theirs";

const sectionAfter = (line: string, current: Section): Section | undefined => {
  if (current === "clean" && line.startsWith(`${marker("<")} `)) return "ours";
  if (current === "ours" && line.startsWith(`${marker("|")} `)) return "base";
  if ((current === "base" || current === "ours") && line === marker("=")) return "theirs";
  if (current === "theirs" && line.startsWith(`${marker(">")} `)) return "clean";
  return undefined;
};

export const splitLines = (text: string): readonly string[] => {
  if (text === "") return [];
  const lines = text.split("\n");
  return text.endsWith("\n") ? lines.slice(0, -1) : lines;
};

export const joinLines = (lines: readonly string[]): string => (lines.length === 0 ? "" : `${lines.join("\n")}\n`);

export const parseSegments = (text: string): readonly Segment[] => {
  const segments: Segment[] = [];
  let section: Section = "clean";
  let clean: string[] = [];
  let parts: Record<"ours" | "base" | "theirs", string[]> = { ours: [], base: [], theirs: [] };
  for (const line of splitLines(text)) {
    const next = sectionAfter(line, section);
    if (next === undefined) {
      (section === "clean" ? clean : parts[section]).push(line);
      continue;
    }
    if (next === "ours" && clean.length > 0) {
      segments.push({ kind: "clean", lines: clean });
      clean = [];
    }
    if (next === "clean") {
      segments.push({ kind: "conflict", ...parts });
      parts = { ours: [], base: [], theirs: [] };
    }
    section = next;
  }
  if (clean.length > 0) segments.push({ kind: "clean", lines: clean });
  return segments;
};

export const conflictsOf = (segments: readonly Segment[]): readonly ConflictSegment[] =>
  segments.filter((segment): segment is ConflictSegment => segment.kind === "conflict");
