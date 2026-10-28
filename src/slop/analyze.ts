import { isTsFamily, type TsApi } from "../quality/ts-api.js";
import { tsDeclarations } from "./ast.js";
import { blockFindings } from "./blocks.js";
import { isAllowed, type SlopConfig } from "./config.js";
import { fileFindings } from "./files.js";
import { type AddedLine, lineFindings } from "./lines.js";
import type { SlopFinding } from "./types.js";

export interface SlopFile {
  readonly file: string;
  readonly text: string;
  readonly added: readonly AddedLine[];
  readonly created: boolean;
}

export interface SlopScan {
  readonly files: readonly SlopFile[];
  readonly exists: (file: string) => boolean;
  readonly config: SlopConfig;
  readonly ts: TsApi | undefined;
}

export const addedByContent = (before: string | undefined, after: string): readonly AddedLine[] => {
  const left = new Map<string, number>();
  for (const line of (before ?? "").split("\n")) left.set(line, (left.get(line) ?? 0) + 1);
  return after.split("\n").flatMap((text, index) => {
    const count = left.get(text) ?? 0;
    if (count > 0) {
      left.set(text, count - 1);
      return [];
    }
    return [{ line: index + 1, text }];
  });
};

const unique = (found: readonly SlopFinding[]): readonly SlopFinding[] => {
  const seen = new Set<string>();
  return found.filter((item) => {
    const key = `${item.detector}\u0000${item.file}\u0000${String(item.line)}\u0000${item.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const scanFile = (scan: SlopScan, item: SlopFile): readonly SlopFinding[] => {
  const lines = item.text.split("\n");
  const lineText = (line: number): string => lines[line - 1] ?? "";
  const declared =
    scan.ts !== undefined && isTsFamily(item.file) ? tsDeclarations(scan.ts, item.file, item.text) : undefined;
  return [
    ...(item.created ? fileFindings({ file: item.file, text: item.text }, scan.exists) : []),
    ...lineFindings(item.file, item.added, scan.config, (line) => lines[line - 1], declared),
    ...blockFindings(item.file, item.text, new Set(item.added.map((added) => added.line)), lineText),
  ];
};

export const analyzeSlop = (scan: SlopScan): readonly SlopFinding[] =>
  unique(
    scan.files
      .filter((item) => !isAllowed(scan.config, item.file))
      .flatMap((item) => scanFile(scan, item))
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
  );
