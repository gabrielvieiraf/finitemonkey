import { matchesAny } from "../core/glob.js";
import { DS_FEATURE, LENGTH_TOLERANCE } from "./ds.js";
import type { TokenSet } from "./tokens.js";
import { issue, type UxIssue, type UxPage } from "./ux.js";

export interface AddedText {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface StaticScope {
  readonly screens: readonly string[];
  readonly tokenFiles: readonly string[];
  readonly excludeFiles: readonly string[];
}

const HEX = /(?:^|[\s:,(='"])(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4}))\b/g;
const COLOR_FUNC = /\b((?:rgba?|hsla?)\(\s*[\d.]+[^)]*\))/g;
const PX = /(?<![\w.[-])(\d+(?:\.\d+)?)px\b/g;
const ARBITRARY = /(?<![\w-])([a-z][\w-]*-\[[^\]\s]+\])/g;
const FONT = /font-family\s*:\s*(?!\s*var\()([^;"'}]+)/g;
const SHADOW = /box-shadow\s*:\s*(?!\s*(?:var\(|none))([^;"'}]+)/g;

const scale = (tokens: TokenSet): readonly number[] => [...tokens.lengths, ...tokens.radii, ...tokens.fontSizes];

const offScale = (value: number, steps: readonly number[]): boolean =>
  steps.length > 0 && value > 1 && !steps.some((step) => Math.abs(step - value) <= LENGTH_TOLERANCE);

export const lineLiterals = (
  text: string,
  tokens: TokenSet,
): readonly { readonly kind: string; readonly literal: string }[] => {
  const steps = scale(tokens);
  const all = (pattern: RegExp, kind: string) =>
    [...text.matchAll(pattern)].map((match) => ({ kind, literal: (match[1] ?? "").trim() }));
  return [
    ...all(HEX, "color"),
    ...all(COLOR_FUNC, "color"),
    ...all(PX, "length")
      .filter((item) => offScale(Number.parseFloat(item.literal), steps))
      .map((item) => ({ ...item, literal: `${item.literal}px` })),
    ...all(ARBITRARY, "arbitrary class"),
    ...all(FONT, "font family"),
    ...all(SHADOW, "shadow"),
  ];
};

const inScope = (scope: StaticScope, file: string): boolean =>
  matchesAny(file, scope.screens) && !scope.tokenFiles.includes(file) && !matchesAny(file, scope.excludeFiles);

export const staticPages = (added: readonly AddedText[], tokens: TokenSet, scope: StaticScope): readonly UxPage[] => {
  const byFile = new Map<string, UxIssue[]>();
  for (const line of added.filter((item) => inScope(scope, item.path))) {
    for (const found of lineLiterals(line.text, tokens)) {
      const list = byFile.get(line.path) ?? [];
      list.push(
        issue(
          "ds/literal",
          found.literal,
          `${line.path}:${String(line.line)} ${found.kind} literal ${found.literal} outside the token files`,
        ),
      );
      byFile.set(line.path, list);
    }
  }
  return [...byFile.entries()].map(([file, issues]) => ({ feature: DS_FEATURE, route: file, viewport: 0, issues }));
};
