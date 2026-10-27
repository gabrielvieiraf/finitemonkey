import { createHash } from "node:crypto";

import { maskText } from "../mask/mask.js";

export interface ErrorSignature {
  readonly sig: string;
  readonly sample: string;
}

const ERROR_LINE =
  /\b(?:error|errors|fail|failed|failure|exception|panic|traceback|assert|assertion|cannot|undefined|expected|denied|refused)\b|✗|✖|\bnot ok\b/i;
const MAX_LINES = 6;
const MAX_SAMPLE = 160;
const SIGNATURE_LENGTH = 4;

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

const stripAnsi = (line: string): string => line.replace(ANSI, "");

export const normalizeErrorLine = (line: string): string =>
  stripAnsi(line)
    .replace(/(?:[A-Za-z]:)?[\\/]?(?:[\w.@-]+[\\/])+([\w.@-]+)/g, "$1")
    .replace(/\b0x[0-9a-f]+\b|\b[0-9a-f]{7,}\b/gi, "H")
    .replace(/\d+(?:\.\d+)?/g, "N")
    .replace(/\s+/g, " ")
    .trim();

export const errorLines = (output: string): readonly string[] => {
  const lines = output
    .split(/\r?\n/)
    .map((line) => stripAnsi(line).trim())
    .filter((line) => line !== "");
  const matching = lines.filter((line) => ERROR_LINE.test(line));
  return (matching.length > 0 ? matching : lines.slice(-3)).slice(0, MAX_LINES);
};

export const errorSignature = (output: string): ErrorSignature | undefined => {
  const raw = errorLines(output);
  const normalized = [...new Set(raw.map(normalizeErrorLine).filter((line) => line !== ""))];
  const first = raw[0];
  if (normalized.length === 0 || first === undefined) return undefined;
  const sig = createHash("sha256").update(normalized.join("\n"), "utf8").digest("hex").slice(0, SIGNATURE_LENGTH);
  return { sig, sample: maskText(first).slice(0, MAX_SAMPLE) };
};

export const shortHash = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
