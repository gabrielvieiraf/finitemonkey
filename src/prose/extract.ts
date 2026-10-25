import { withoutCarriageReturn } from "../core/posix-path.js";
import { allowsLine, allowsWholeFile, isMarkerOnlyLine } from "./marker.js";
import type { ProseUnit, UnitKind } from "./types.js";

interface Piece {
  readonly text: string;
  readonly line: number;
}

interface Block {
  readonly kind: UnitKind;
  readonly pieces: readonly Piece[];
}

export interface Extracted {
  readonly units: readonly ProseUnit[];
  readonly allowed: boolean;
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^#{1,6}\s+/;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const SKIPPED_LINE = /^\s*[|>]|^\s*<(?!!--)/;
const INDENTED_CODE = /^(?: {4}|\t)/;
const SENTENCE_END = /(?<=[.!?…])\s+/;

const MASKS: readonly (readonly [RegExp, string])[] = [
  [/!\[[^\]]*\]\([^)]*\)/g, ""],
  [/\[[^\]]*\]\([^)]*\)/g, "x"],
  [/\[[^\]]+\]\[[^\]]*\]/g, "x"],
  [/`[^`]*`/g, "x"],
  [/https?:\/\/\S+/g, "x"],
  [/"[^"]*"|“[^”]*”|«[^»]*»/g, "x"],
  [/<[^>]+>/g, ""],
  [/\*\*|__/g, ""],
];

export const maskInline = (line: string): string =>
  MASKS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), line);

class BlockReader {
  readonly blocks: Block[] = [];
  private current: { kind: UnitKind; pieces: Piece[] } | undefined;
  private skipNext = false;

  flush(): void {
    const block = this.current;
    this.current = undefined;
    if (block === undefined || block.pieces.length === 0) return;
    if (this.skipNext) {
      this.skipNext = false;
      return;
    }
    this.blocks.push(block);
  }

  skipNextBlock(): void {
    this.flush();
    this.skipNext = true;
  }

  start(kind: UnitKind, piece: Piece): void {
    this.flush();
    this.current = { kind, pieces: [piece] };
    if (kind === "heading") this.flush();
  }

  append(piece: Piece): void {
    this.current ??= { kind: "sentence", pieces: [] };
    this.current.pieces.push(piece);
  }

  get open(): boolean {
    return this.current !== undefined;
  }
}

const readLine = (reader: BlockReader, raw: string, line: number): void => {
  if (raw.trim() === "") {
    reader.flush();
  } else if (isMarkerOnlyLine(raw)) {
    reader.skipNextBlock();
  } else if (allowsLine(raw)) {
    return;
  } else if (HEADING.test(raw)) {
    reader.start("heading", { text: raw.replace(HEADING, ""), line });
  } else if (SKIPPED_LINE.test(raw) || raw.trim().startsWith("<!--")) {
    reader.flush();
  } else if (ITEM.test(raw)) {
    reader.start("item", { text: raw.replace(ITEM, ""), line });
  } else if (INDENTED_CODE.test(raw) && !reader.open) {
    return;
  } else {
    reader.append({ text: raw.trim(), line });
  }
};

const skipFrontmatter = (lines: readonly string[]): number => {
  if (lines[0]?.trim() !== "---") return 0;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  return end < 0 ? 0 : end + 1;
};

const readBlocks = (lines: readonly string[]): readonly Block[] => {
  const reader = new BlockReader();
  let fenced = false;
  let commented = false;
  for (let index = skipFrontmatter(lines); index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    if (FENCE.test(raw)) {
      fenced = !fenced;
      reader.flush();
    } else if (commented) {
      commented = !raw.includes("-->");
    } else if (!fenced) {
      if (raw.trim().startsWith("<!--") && !raw.includes("-->")) commented = true;
      readLine(reader, raw, index + 1);
    }
  }
  reader.flush();
  return reader.blocks;
};

const splitBlock = (block: Block): readonly Piece[] => {
  if (block.kind === "heading") return block.pieces.map((piece) => ({ ...piece, text: maskInline(piece.text) }));
  const starts: number[] = [];
  let joined = "";
  for (const piece of block.pieces) {
    starts.push(joined.length);
    joined += `${maskInline(piece.text)} `;
  }
  const lineAt = (offset: number): number => {
    const index = starts.findLastIndex((start) => start <= offset);
    return block.pieces[Math.max(index, 0)]?.line ?? 0;
  };
  let offset = 0;
  return joined.split(SENTENCE_END).flatMap((sentence) => {
    const at = joined.indexOf(sentence, offset);
    offset = at + sentence.length;
    const text = sentence.trim();
    return text === "" ? [] : [{ text, line: lineAt(at) }];
  });
};

const unitsOf = (blocks: readonly Block[]): readonly ProseUnit[] => {
  let section = 0;
  return blocks.flatMap((block, paragraph) => {
    if (block.kind === "heading") section += 1;
    const pieces = splitBlock(block);
    const next = blocks[paragraph + 1];
    const closesSection = block.kind === "sentence" && (next === undefined || next.kind === "heading");
    return pieces.map((piece, index) => ({
      text: piece.text,
      line: piece.line,
      paragraph,
      section,
      kind: block.kind,
      lastInParagraph: index === pieces.length - 1,
      closesSection,
    }));
  });
};

export const extractProse = (text: string): Extracted => {
  if (allowsWholeFile(text)) return { units: [], allowed: true };
  const lines = text.split("\n").map(withoutCarriageReturn);
  return { units: unitsOf(readBlocks(lines)), allowed: false };
};
