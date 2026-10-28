import { finding, type SlopFinding } from "./types.js";

const SCRIPT = /\.(?:[cm]?[jt]sx?)$/;

const blankComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (match, lead: string) => `${lead}${" ".repeat(match.length - lead.length)}`);

const lineAt = (text: string, index: number): number => text.slice(0, index).split("\n").length;

const EMPTY_CATCH = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
const PY_ONE_LINE = /^[ \t]*except\b[^\n:]*:[ \t]*pass[ \t]*$/gm;
const PY_SWALLOW = /^[ \t]*except\b[^\n:]*:[ \t]*\n[ \t]*(?:pass|\.\.\.)[ \t]*$/gm;
const ARROW_WRAPPER =
  /(?:^|\n)[ \t]*(?:export\s+)?(?:const|let)\s+([\w$]+)\s*=\s*(?:async\s+)?\(([^()]*)\)\s*(?::[^=\n]+)?=>\s*(?:await\s+)?([\w$.]+)\(([^()]*)\)\s*;?[ \t]*(?=\n|$)/g;
const FUNCTION_WRAPPER =
  /(?:^|\n)[ \t]*(?:export\s+)?(?:async\s+)?function\s+([\w$]+)\s*\(([^()]*)\)[^{\n]*\{\s*return\s+(?:await\s+)?([\w$.]+)\(([^()]*)\);?\s*\}/g;

const names = (list: string): readonly string[] =>
  list
    .split(",")
    .map((item) =>
      item
        .replace(/[?]?\s*:.*$/s, "")
        .replace(/=.*$/s, "")
        .trim(),
    )
    .filter((item) => item !== "");

const isPassThrough = (match: RegExpMatchArray): boolean => {
  const params = names(match[2] ?? "");
  const args = names(match[4] ?? "");
  const callee = match[3] ?? "";
  return params.length > 0 && callee !== match[1] && params.join(",") === args.join(",");
};

const located = (text: string, match: RegExpMatchArray): number => {
  const start = (match.index ?? 0) + (match[0].startsWith("\n") ? 1 : 0);
  return lineAt(text, start);
};

export const blockFindings = (
  file: string,
  text: string,
  added: ReadonlySet<number>,
  lineText: (line: number) => string,
): readonly SlopFinding[] => {
  const found: SlopFinding[] = [];
  const keep = (detector: SlopFinding["detector"], line: number, detail = ""): void => {
    if (added.has(line)) found.push(finding(detector, file, line, lineText(line), detail));
  };
  if (SCRIPT.test(file)) {
    const code = blankComments(text);
    for (const match of code.matchAll(EMPTY_CATCH)) keep("swallowed_error", located(code, match));
    for (const pattern of [ARROW_WRAPPER, FUNCTION_WRAPPER]) {
      for (const match of code.matchAll(pattern)) {
        if (isPassThrough(match)) keep("pass_through", located(code, match), match[1] ?? "");
      }
    }
  }
  if (file.endsWith(".py")) {
    for (const match of text.matchAll(PY_SWALLOW)) keep("swallowed_error", located(text, match) + 1);
    for (const match of text.matchAll(PY_ONE_LINE)) keep("swallowed_error", located(text, match));
  }
  return found;
};
