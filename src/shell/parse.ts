import type { Redirect, Token, WordToken } from "./types.js";

export interface RawCommand {
  readonly words: readonly WordToken[];
  readonly redirects: readonly Redirect[];
  readonly stdin: string | undefined;
}

const PREFIX_WORDS = new Set(["!", "{", "}", "if", "then", "elif", "else", "do", "while", "until"]);
const SKIP_WORDS = new Set(["fi", "done", "esac", "}", "for", "case", "select", "function", "in"]);

const trimKeywords = (words: readonly WordToken[]): readonly WordToken[] => {
  let start = 0;
  while (start < words.length && !words[start]?.quoted && PREFIX_WORDS.has(words[start]?.text ?? "")) start += 1;
  const rest = words.slice(start);
  const first = rest[0];
  if (first !== undefined && !first.quoted && SKIP_WORDS.has(first.text)) return [];
  return rest;
};

interface Building {
  words: WordToken[];
  redirects: Redirect[];
  stdin: string | undefined;
}

const fresh = (): Building => ({ words: [], redirects: [], stdin: undefined });

const close = (building: Building, out: RawCommand[]): void => {
  const words = trimKeywords(building.words);
  if (words.length > 0 || building.redirects.length > 0 || building.stdin !== undefined) {
    out.push({ words, redirects: building.redirects, stdin: building.stdin });
  }
};

export const rawCommands = (tokens: readonly Token[]): readonly RawCommand[] => {
  const out: RawCommand[] = [];
  let building = fresh();
  for (const token of tokens) {
    if (token.kind === "op") {
      close(building, out);
      building = fresh();
    } else if (token.kind === "word") {
      building.words.push(token);
    } else {
      building.redirects.push({ op: token.op, fd: token.fd, target: token.target });
      if (token.body !== undefined) building.stdin = token.body;
      else if (token.op === "<<<") building.stdin = token.target;
    }
  }
  close(building, out);
  return out;
};
