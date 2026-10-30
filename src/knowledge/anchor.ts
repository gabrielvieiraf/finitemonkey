import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { nameIn } from "../map/defs.js";
import { sha256Hex } from "../secrets/fingerprint.js";

export const ANCHOR_MODES = ["symbol", "file"] as const;

export type AnchorMode = (typeof ANCHOR_MODES)[number];

export interface Anchor {
  readonly path: string;
  readonly symbol?: string;
  readonly mode: AnchorMode;
  readonly hash: string;
}

const normalize = (lines: readonly string[]): string =>
  lines
    .map((line) => line.replace(/\r$/, "").trimEnd())
    .filter((line) => line.trim() !== "")
    .join("\n");

const digest = (text: string): string => sha256Hex(text).slice(0, 16);

const startsDefinition = (line: string): boolean => !/^\s/.test(line) && nameIn(line) !== undefined;

export const symbolBody = (text: string, symbol: string): string | undefined => {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => !/^\s/.test(line) && nameIn(line) === symbol);
  if (start < 0) return undefined;
  const next = lines.findIndex((line, index) => index > start && startsDefinition(line));
  return normalize(lines.slice(start, next < 0 ? lines.length : next));
};

export const hashOf = (
  text: string,
  symbol: string | undefined,
): { readonly mode: AnchorMode; readonly hash: string } | undefined => {
  if (symbol === undefined) return { mode: "file", hash: digest(normalize(text.split("\n"))) };
  const body = symbolBody(text, symbol);
  return body === undefined ? undefined : { mode: "symbol", hash: digest(body) };
};

export const anchorAt = (text: string, path: string, symbol: string | undefined): Anchor | undefined => {
  const hashed = hashOf(text, symbol);
  if (hashed === undefined) return undefined;
  return { path, ...(symbol === undefined ? {} : { symbol }), ...hashed };
};

export type AnchorState = "same" | "changed" | "missing";

export const anchorState = (anchor: Anchor, text: string | undefined): AnchorState => {
  if (text === undefined) return "missing";
  const hashed = hashOf(text, anchor.symbol);
  if (hashed === undefined) return "missing";
  return hashed.hash === anchor.hash ? "same" : "changed";
};

export type ReadFile = (relative: string) => string | undefined;

export const diskReader =
  (runtime: Pick<Runtime, "readText">, root: AbsolutePath): ReadFile =>
  (relative) => {
    const text = runtime.readText(toAbsolutePath(join(root, ...relative.split("/"))));
    return text.ok ? text.value : undefined;
  };

export const relocate = (anchor: Anchor, candidates: readonly string[], read: ReadFile): Anchor | undefined => {
  for (const path of candidates) {
    if (path === anchor.path) continue;
    const text = read(path);
    if (text !== undefined && anchorState(anchor, text) === "same") return { ...anchor, path };
  }
  return undefined;
};
