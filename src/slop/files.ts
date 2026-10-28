import { posix } from "node:path";

import { siblingStem } from "./names.js";
import { finding, type SlopFinding } from "./types.js";

export interface NewFile {
  readonly file: string;
  readonly text: string;
}

const REEXPORT =
  /^\s*(?:export\s+(?:type\s+)?(?:\*|\{[^}]*\})(?:\s+as\s+[\w$]+)?\s+from\s+["'][^"']+["'];?|module\.exports\s*=\s*require\(\s*["'][^"']+["']\s*\);?)\s*$/;
const SCRIPT = /\.(?:[cm]?[jt]sx?)$/;
const BARREL = /(^|\/)index\.[cm]?[jt]sx?$/;
const SUMMARY = /(?:summary|implementation)[^/]*\.(?:md|markdown)$/i;
const IN_DOCS = /(^|\/)docs?\//;

const siblingOf = (file: string, exists: (file: string) => boolean): string | undefined => {
  const dir = posix.dirname(file);
  const base = posix.basename(file);
  const dot = base.indexOf(".", 1);
  const stem = dot < 0 ? base : base.slice(0, dot);
  const ext = dot < 0 ? "" : base.slice(dot);
  const original = siblingStem(stem);
  if (original === undefined) return undefined;
  const candidate = dir === "." ? `${original}${ext}` : `${dir}/${original}${ext}`;
  return exists(candidate) ? candidate : undefined;
};

const isShim = (file: string, text: string): boolean => {
  if (!SCRIPT.test(file) || BARREL.test(file)) return false;
  const lines = text.split("\n").filter((line) => line.trim() !== "" && !/^\s*(?:\/\/|\/\*|\*)/.test(line));
  return lines.length > 0 && lines.every((line) => REEXPORT.test(line));
};

export const fileFindings = (created: NewFile, exists: (file: string) => boolean): readonly SlopFinding[] => {
  const { file, text } = created;
  const sibling = siblingOf(file, exists);
  return [
    ...(sibling === undefined ? [] : [finding("sibling_file", file, 1, file, sibling)]),
    ...(isShim(file, text) ? [finding("reexport_shim", file, 1, file)] : []),
    ...(SUMMARY.test(file) && !IN_DOCS.test(file) ? [finding("summary_markdown", file, 1, file)] : []),
  ];
};
