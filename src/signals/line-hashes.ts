import { createHash } from "node:crypto";

export const MAX_LINE_HASHES = 2000;

export const lineHash = (text: string): string =>
  createHash("sha256").update(text.trim(), "utf8").digest("hex").slice(0, 10);

export const meaningful = (text: string): boolean => text.trim() !== "";

export const hashLines = (lines: readonly string[]): readonly string[] =>
  [...new Set(lines.filter(meaningful).map(lineHash))].sort();

export const cappedHashes = (hashes: readonly string[]): readonly string[] | undefined =>
  hashes.length > MAX_LINE_HASHES ? undefined : hashes;

export const hashText = (text: string): readonly string[] | undefined => cappedHashes(hashLines(text.split("\n")));
