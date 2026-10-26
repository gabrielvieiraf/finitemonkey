import { isWeak } from "./lines.js";
import type { Finding, Hunk, Side } from "./types.js";

const DECLARATION = /\b(?:function\*?|class|interface|type|enum|def|fn|func|struct|trait)\s+([A-Za-z_$][\w$]*)/g;
const BINDING = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/g;
const KEY = /^["']?([A-Za-z_$][\w$.-]*)["']?\s*:(?!:)/;
const TEST = /\b(?:it|test|describe|context)(?:\.\w+)?\s*\(\s*(["'`])(.+?)\1/;
const RESERVED = new Set(["default", "case", "http", "https"]);

export interface UnitSymbol {
  readonly name: string;
  readonly test: boolean;
}

export const symbolsOf = (line: string): readonly UnitSymbol[] => {
  if (isWeak(line)) return [];
  const names = [...line.matchAll(DECLARATION), ...line.matchAll(BINDING)].map((match) => match[1] ?? "");
  const key = KEY.exec(line)?.[1];
  const title = TEST.exec(line)?.[2];
  return [
    ...[...names, ...(key === undefined ? [] : [key])]
      .filter((name) => name.length > 1 && !RESERVED.has(name))
      .map((name) => ({ name, test: false })),
    ...(title === undefined ? [] : [{ name: title, test: true }]),
  ];
};

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const containsSymbol = (text: string, symbol: UnitSymbol): boolean =>
  symbol.test ? text.includes(symbol.name) : new RegExp(`(?<![\\w$])${escapeRegex(symbol.name)}(?![\\w$])`).test(text);

export const missingSymbols = (
  file: string,
  side: Side,
  hunks: readonly Hunk[],
  present: (symbol: UnitSymbol) => boolean,
): readonly Finding[] => {
  const seen = new Set<string>();
  return hunks.flatMap((hunk) =>
    hunk.added.flatMap((raw, offset): Finding[] => {
      return symbolsOf(raw.trim()).flatMap((symbol): Finding[] => {
        if (seen.has(symbol.name) || present(symbol)) return [];
        seen.add(symbol.name);
        return [{ kind: "missing-symbol", file, side, line: hunk.newStart + offset, text: symbol.name, weak: false }];
      });
    }),
  );
};
