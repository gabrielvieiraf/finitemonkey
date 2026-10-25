import { atEnd, type Cursor, cursorOf, peek, readAnsiC, readBalanced, readUntil } from "./scan.js";
import type { Lexed, RedirectToken, Token, WordToken } from "./types.js";

const OPERATORS = ["&&", "||", ";;", "|&", "|", "&", ";", "(", ")", "\n"] as const;
const REDIRECT = /^(\d*)(<<<|<<-|<<|<>|<&|>>|>&|>\||<|>)|^(&>>|&>)/;
const BOUNDARY = new Set([" ", "\t", "\n", "|", "&", ";", "(", ")", "<", ">"]);

interface WordState {
  text: string;
  quoted: boolean;
  dynamic: boolean;
}

const dollar = (cursor: Cursor, state: WordState, inDouble: boolean): void => {
  const next = peek(cursor, 1);
  state.dynamic = true;
  if (next === "(" && peek(cursor, 2) === "(") {
    cursor.pos += 3;
    state.text += `$((${readBalanced(cursor, "(", ")")})`;
    if (peek(cursor) === ")") cursor.pos += 1;
  } else if (next === "(") {
    cursor.pos += 2;
    const inner = readBalanced(cursor, "(", ")");
    cursor.subs.push(inner);
    state.text += `$(${inner})`;
  } else if (next === "{") {
    cursor.pos += 2;
    state.text += `\${${readBalanced(cursor, "{", "}")}}`;
  } else if (next === "'" && !inDouble) {
    cursor.pos += 2;
    state.dynamic = false;
    state.quoted = true;
    state.text += readAnsiC(cursor);
  } else {
    cursor.pos += 1;
    state.text += "$";
  }
};

const backtick = (cursor: Cursor, state: WordState): void => {
  cursor.pos += 1;
  const inner = readUntil(cursor, "`", true);
  cursor.subs.push(inner);
  state.text += `\`${inner}\``;
  state.dynamic = true;
};

const DOUBLE_ESCAPES = new Set(["$", "`", '"', "\\", "\n"]);

const doubleQuoted = (cursor: Cursor, state: WordState): void => {
  cursor.pos += 1;
  state.quoted = true;
  while (!atEnd(cursor) && peek(cursor) !== '"') {
    const char = peek(cursor);
    if (char === "\\" && DOUBLE_ESCAPES.has(peek(cursor, 1))) {
      if (peek(cursor, 1) !== "\n") state.text += peek(cursor, 1);
      cursor.pos += 2;
    } else if (char === "$") dollar(cursor, state, true);
    else if (char === "`") backtick(cursor, state);
    else {
      state.text += char;
      cursor.pos += 1;
    }
  }
  if (atEnd(cursor)) cursor.incomplete = true;
  cursor.pos += 1;
};

const wordPart = (cursor: Cursor, state: WordState): void => {
  const char = peek(cursor);
  if (char === "\\") {
    if (peek(cursor, 1) !== "\n") state.text += peek(cursor, 1);
    cursor.pos += 2;
  } else if (char === "'") {
    cursor.pos += 1;
    state.quoted = true;
    state.text += readUntil(cursor, "'", false);
  } else if (char === '"') doubleQuoted(cursor, state);
  else if (char === "$") dollar(cursor, state, false);
  else if (char === "`") backtick(cursor, state);
  else {
    state.text += char;
    cursor.pos += 1;
  }
};

const readWord = (cursor: Cursor): WordToken => {
  const state: WordState = { text: "", quoted: false, dynamic: false };
  while (!atEnd(cursor) && !BOUNDARY.has(peek(cursor))) wordPart(cursor, state);
  return { kind: "word", ...state };
};

const skipBlank = (cursor: Cursor): void => {
  while (peek(cursor) === " " || peek(cursor) === "\t" || (peek(cursor) === "\\" && peek(cursor, 1) === "\n")) {
    cursor.pos += peek(cursor) === "\\" ? 2 : 1;
  }
};

const heredocBody = (cursor: Cursor, delimiter: string, stripTabs: boolean): string => {
  const lines: string[] = [];
  while (!atEnd(cursor)) {
    const end = cursor.text.indexOf("\n", cursor.pos);
    const line = cursor.text.slice(cursor.pos, end < 0 ? undefined : end);
    cursor.pos = end < 0 ? cursor.text.length : end + 1;
    const compared = stripTabs ? line.replace(/^\t+/, "") : line;
    if (compared === delimiter) return lines.join("\n");
    lines.push(compared);
  }
  cursor.incomplete = true;
  return lines.join("\n");
};

interface Pending {
  readonly index: number;
  readonly token: RedirectToken;
}

const readRedirect = (cursor: Cursor, match: RegExpExecArray): RedirectToken => {
  const op = match[2] ?? match[3] ?? "";
  cursor.pos += match[0].length;
  skipBlank(cursor);
  const processSub = peek(cursor) === "(" && op === "<";
  const target = processSub ? "" : readWord(cursor).text;
  return { kind: "redirect", op, fd: match[1] ?? "", target, body: undefined };
};

const processSubstitution = (cursor: Cursor): boolean => {
  if ((peek(cursor) !== "<" && peek(cursor) !== ">") || peek(cursor, 1) !== "(") return false;
  cursor.pos += 2;
  cursor.subs.push(readBalanced(cursor, "(", ")"));
  return true;
};

const flushHeredocs = (cursor: Cursor, tokens: Token[], pending: Pending[]): void => {
  for (const { index, token } of pending.splice(0)) {
    tokens[index] = { ...token, body: heredocBody(cursor, token.target, token.op === "<<-") };
  }
};

const nextToken = (cursor: Cursor, tokens: Token[], pending: Pending[]): void => {
  if (peek(cursor) === "#") {
    const end = cursor.text.indexOf("\n", cursor.pos);
    cursor.pos = end < 0 ? cursor.text.length : end;
    return;
  }
  if (processSubstitution(cursor)) return;
  const redirect = REDIRECT.exec(cursor.text.slice(cursor.pos, cursor.pos + 4));
  if (redirect !== null) {
    const token = readRedirect(cursor, redirect);
    if (token.op === "<<" || token.op === "<<-") pending.push({ index: tokens.length, token });
    tokens.push(token);
    return;
  }
  const op = OPERATORS.find((candidate) => cursor.text.startsWith(candidate, cursor.pos));
  if (op === undefined) {
    tokens.push(readWord(cursor));
    return;
  }
  cursor.pos += op.length;
  tokens.push({ kind: "op", text: op });
  if (op === "\n") flushHeredocs(cursor, tokens, pending);
};

export const lexBash = (text: string): Lexed => {
  const cursor = cursorOf(text.replace(/\r\n/g, "\n"));
  const tokens: Token[] = [];
  const pending: Pending[] = [];
  for (skipBlank(cursor); !atEnd(cursor); skipBlank(cursor)) nextToken(cursor, tokens, pending);
  flushHeredocs(cursor, tokens, pending);
  return { tokens, substitutions: cursor.subs, incomplete: cursor.incomplete };
};
