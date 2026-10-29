import { toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";

export type ApiRuntime = Pick<Runtime, "readText" | "listDir">;

export type ApiFindingKind = "missing" | "arity" | "keyword" | "deprecated" | "uncertain" | "not_verified";

export interface ApiFinding {
  readonly kind: ApiFindingKind;
  readonly file: string;
  readonly pkg: string;
  readonly symbol: string;
  readonly version: string;
  readonly detail: string;
}

export interface Signature {
  readonly required: number;
  readonly max: number;
  readonly keywords: readonly string[] | undefined;
  readonly deprecated: boolean;
}

export interface Surface {
  readonly version: string;
  readonly exports: ReadonlyMap<string, Signature>;
  readonly dynamic: boolean;
}

export interface Imported {
  readonly pkg: string;
  readonly symbol: string;
  readonly local: string;
}

export interface Call {
  readonly positional: number;
  readonly keywords: readonly string[];
}

export const read = (runtime: ApiRuntime, path: string): string | undefined => {
  const text = runtime.readText(toAbsolutePath(path));
  return text.ok ? text.value : undefined;
};

export const splitTopLevel = (text: string): readonly string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let current = "";
  for (const char of text) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if ("([{<".includes(char)) depth += 1;
    else if (")]}>".includes(char)) depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
};

export const closing = (text: string, open: number): number => {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
};

export const callsOf = (source: string, local: string): readonly Call[] => {
  const pattern = new RegExp(`(?<![\\w.$])${local.replace(/[$]/g, "\\$")}\\s*\\(`, "g");
  const calls: Call[] = [];
  for (const match of source.matchAll(pattern)) {
    const open = match.index + match[0].length - 1;
    const end = closing(source, open);
    if (end < 0) continue;
    const args = splitTopLevel(source.slice(open + 1, end));
    const keywords = args.flatMap((arg) => /^([A-Za-z_]\w*)\s*=(?!=)/.exec(arg)?.[1] ?? []);
    calls.push({ positional: args.length - keywords.length, keywords });
  }
  return calls;
};

export type Resolved =
  | { readonly kind: "surface"; readonly surface: Surface }
  | { readonly kind: "unknown"; readonly detail: string; readonly version: string };
