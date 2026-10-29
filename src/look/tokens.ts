import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseColor, type Rgba, toHex } from "./color.js";
import type { ProbeNode } from "./probe.js";

export const REM_PX = 16;

export interface TokenSet {
  readonly colors: readonly Rgba[];
  readonly lengths: readonly number[];
  readonly radii: readonly number[];
  readonly fontSizes: readonly number[];
  readonly fonts: readonly string[];
  readonly shadows: readonly string[];
  readonly sources: readonly string[];
}

export const EMPTY_TOKENS: TokenSet = {
  colors: [],
  lengths: [],
  radii: [],
  fontSizes: [],
  fonts: [],
  shadows: [],
  sources: [],
};

export const hasTokens = (tokens: TokenSet): boolean =>
  tokens.colors.length + tokens.lengths.length + tokens.radii.length + tokens.fontSizes.length + tokens.fonts.length >
  0;

export const lengthOf = (raw: string): number | undefined => {
  const match = /^(-?\d*\.?\d+)(px|rem)?$/.exec(raw.trim());
  if (match?.[1] === undefined) return undefined;
  const value = Number.parseFloat(match[1]);
  return match[2] === "rem" ? value * REM_PX : value;
};

const firstFont = (raw: string): string =>
  (raw.split(",")[0] ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();

interface Collected {
  colors: Rgba[];
  lengths: number[];
  radii: number[];
  fontSizes: number[];
  fonts: string[];
  shadows: string[];
}

const fresh = (): Collected => ({ colors: [], lengths: [], radii: [], fontSizes: [], fonts: [], shadows: [] });

const place = (into: Collected, path: string, type: string | undefined, raw: string): void => {
  const name = path.toLowerCase();
  const color = type === "color" || type === undefined ? parseColor(raw) : undefined;
  if (color !== undefined) {
    into.colors.push(color);
    return;
  }
  if (type === "fontFamily" || /font-?family|typeface/.test(name)) {
    into.fonts.push(firstFont(raw));
    return;
  }
  if (type === "shadow" || /shadow|elevation/.test(name)) {
    into.shadows.push(raw.trim());
    return;
  }
  const length = lengthOf(raw);
  if (length === undefined) return;
  if (/radius|radii|rounded/.test(name)) into.radii.push(length);
  else if (/font-?size|text-|type-?scale/.test(name)) into.fontSizes.push(length);
  else into.lengths.push(length);
};

const walkW3c = (node: unknown, path: string, inherited: string | undefined, into: Collected): void => {
  if (!isRecord(node)) return;
  const type = typeof node["$type"] === "string" ? node["$type"] : inherited;
  const value = node["$value"];
  if (typeof value === "string" || typeof value === "number") {
    place(into, path, type, typeof value === "number" ? `${String(value)}px` : value);
    return;
  }
  for (const [key, child] of Object.entries(node))
    if (!key.startsWith("$")) walkW3c(child, `${path}.${key}`, type, into);
};

const CUSTOM_PROPERTY = /--([\w-]+)\s*:\s*([^;}{]+)[;}]/g;

const walkCss = (source: string, into: Collected): void => {
  for (const match of source.matchAll(CUSTOM_PROPERTY)) {
    const [, name = "", value = ""] = match;
    if (!value.includes("var(")) place(into, name, undefined, value.trim());
  }
};

export const loadTokens = (runtime: Pick<Runtime, "readText">, root: string, files: readonly string[]): TokenSet => {
  const into = fresh();
  const sources: string[] = [];
  for (const file of files) {
    const text = runtime.readText(toAbsolutePath(join(root, file)));
    if (!text.ok) continue;
    sources.push(file);
    if (file.endsWith(".json")) {
      const parsed = parseJsonObject(text.value);
      if (parsed.ok) walkW3c(parsed.value, "", undefined, into);
    } else walkCss(text.value, into);
  }
  return { ...into, sources };
};

const top = <T>(values: readonly T[], key: (value: T) => string, count: number): readonly T[] => {
  const tally = new Map<string, { value: T; hits: number }>();
  for (const value of values) {
    const entry = tally.get(key(value)) ?? { value, hits: 0 };
    tally.set(key(value), { value: entry.value, hits: entry.hits + 1 });
  }
  return [...tally.values()]
    .sort((left, right) => right.hits - left.hits)
    .slice(0, count)
    .map((entry) => entry.value);
};

export const proposeTokens = (nodes: readonly ProbeNode[]): Readonly<Record<string, unknown>> => {
  const shown = nodes.filter((node) => node.visible);
  const colors = top(
    shown
      .flatMap((node) => [node.color, node.bg].flatMap((raw) => parseColor(raw) ?? []))
      .filter((color) => color.a > 0),
    toHex,
    12,
  );
  const ascending = (values: readonly number[]): readonly number[] => [...values].sort((a, b) => a - b);
  const spacing = ascending(
    top(
      shown.flatMap((node) => node.spacing.filter((value) => value > 0)),
      String,
      10,
    ),
  );
  const radii = ascending(
    top(
      shown.map((node) => node.radius).filter((value) => value > 0),
      String,
      6,
    ),
  );
  const sizes = ascending(
    top(
      shown.map((node) => node.fontSize).filter((value) => value > 0),
      String,
      8,
    ),
  );
  const fonts = top(
    shown.map((node) => firstFont(node.fontFamily)).filter((font) => font !== ""),
    (font) => font,
    3,
  );
  const group = (type: string, values: readonly (string | number)[], unit = "") =>
    Object.fromEntries(
      values.map((value, index) => [String(index + 1), { $type: type, $value: `${String(value)}${unit}` }]),
    );
  return {
    color: group("color", colors.map(toHex)),
    space: group("dimension", spacing, "px"),
    radius: group("dimension", radii, "px"),
    "font-size": group("dimension", sizes, "px"),
    "font-family": group("fontFamily", fonts),
  };
};
