import { createHash } from "node:crypto";

import { maskText } from "../mask/mask.js";

export interface ErrorSignature {
  readonly sig: string;
  readonly sample: string;
}

const ERROR_LINE =
  /\b(?:error|errors|fail|failed|failure|exception|panic|traceback|assert|assertion|cannot|undefined|expected|denied|refused|fatal|invalid)\b|\bnot found\b|\bno such\b|\bno matches\b|\bparse error\b|✗|✖|\bnot ok\b/i;
const PASS_LINE = /^(?:✔|✓|ok\b|ℹ\s|#\s*(?:pass|ok)\b)/i;
const EXIT_LINE = /^(?:Error: )?Exit code \d+$|^\[exited with code \d+\]$/i;
const TAIL_LINES = 3;
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

interface ErrorLines {
  readonly lines: readonly string[];
  readonly sample: string | undefined;
}

const outputLines = (output: string): readonly string[] =>
  output
    .split(/\r?\n/)
    .map((line) => stripAnsi(line).trim())
    .filter((line) => line !== "");

const pickLines = (output: string): ErrorLines => {
  const all = outputLines(output);
  const status = all.find((line) => EXIT_LINE.test(line));
  const body = all.filter((line) => !EXIT_LINE.test(line));
  const matching = body.filter((line) => ERROR_LINE.test(line) && !PASS_LINE.test(line));
  if (matching.length > 0) return { lines: matching.slice(0, MAX_LINES), sample: matching[0] };
  const tail = body.slice(-TAIL_LINES);
  return { lines: tail, sample: status ?? tail.find((line) => !PASS_LINE.test(line)) ?? tail[0] };
};

export const errorSignature = (output: string): ErrorSignature | undefined => {
  const { lines: raw, sample: first } = pickLines(output);
  const normalized = [...new Set(raw.map(normalizeErrorLine).filter((line) => line !== ""))];
  if (normalized.length === 0 || first === undefined) return undefined;
  const sig = createHash("sha256").update(normalized.join("\n"), "utf8").digest("hex").slice(0, SIGNATURE_LENGTH);
  return { sig, sample: maskText(first).slice(0, MAX_SAMPLE) };
};

export const shortHash = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
