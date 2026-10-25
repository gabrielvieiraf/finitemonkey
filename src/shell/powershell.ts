import { atEnd, type Cursor, cursorOf, peek, readBalanced } from "./scan.js";
import type { Lexed, Token, WordToken } from "./types.js";

const OPERATORS = ["&&", "||", ";", "|", "\n", "(", ")", "{", "}"] as const;
const REDIRECT = /^(\*|\d)?(>>|>)(&\d)?/;
const BOUNDARY = new Set([" ", "\t", "\n", ";", "|", "(", ")", "{", "}", ">"]);

interface State {
  text: string;
  quoted: boolean;
  dynamic: boolean;
}

const single = (cursor: Cursor, state: State): void => {
  cursor.pos += 1;
  state.quoted = true;
  while (!atEnd(cursor)) {
    if (peek(cursor) === "'" && peek(cursor, 1) === "'") {
      state.text += "'";
      cursor.pos += 2;
    } else if (peek(cursor) === "'") {
      cursor.pos += 1;
      return;
    } else {
      state.text += peek(cursor);
      cursor.pos += 1;
    }
  }
  cursor.incomplete = true;
};

const subexpression = (cursor: Cursor, state: State): void => {
  cursor.pos += 2;
  const inner = readBalanced(cursor, "(", ")");
  cursor.subs.push(inner);
  state.text += `$(${inner})`;
  state.dynamic = true;
};

const double = (cursor: Cursor, state: State): void => {
  cursor.pos += 1;
  state.quoted = true;
  while (!atEnd(cursor)) {
    const char = peek(cursor);
    if (char === "`") {
      state.text += peek(cursor, 1);
      cursor.pos += 2;
    } else if (char === '"' && peek(cursor, 1) === '"') {
      state.text += '"';
      cursor.pos += 2;
    } else if (char === '"') {
      cursor.pos += 1;
      return;
    } else if (char === "$" && peek(cursor, 1) === "(") subexpression(cursor, state);
    else {
      if (char === "$") state.dynamic = true;
      state.text += char;
      cursor.pos += 1;
    }
  }
  cursor.incomplete = true;
};

const part = (cursor: Cursor, state: State): void => {
  const char = peek(cursor);
  if (char === "`") {
    state.text += peek(cursor, 1);
    cursor.pos += 2;
  } else if (char === "'") single(cursor, state);
  else if (char === '"') double(cursor, state);
  else if (char === "$" && peek(cursor, 1) === "(") subexpression(cursor, state);
  else {
    if (char === "$") state.dynamic = true;
    state.text += char;
    cursor.pos += 1;
  }
};

const word = (cursor: Cursor, ampersandSplits: boolean): WordToken => {
  const state: State = { text: "", quoted: false, dynamic: false };
  while (!atEnd(cursor) && !BOUNDARY.has(peek(cursor)) && !(ampersandSplits && peek(cursor) === "&")) {
    part(cursor, state);
  }
  return { kind: "word", ...state };
};

const skipComment = (cursor: Cursor): boolean => {
  if (cursor.text.startsWith("<#", cursor.pos)) {
    const end = cursor.text.indexOf("#>", cursor.pos);
    cursor.pos = end < 0 ? cursor.text.length : end + 2;
    return true;
  }
  if (peek(cursor) !== "#") return false;
  const end = cursor.text.indexOf("\n", cursor.pos);
  cursor.pos = end < 0 ? cursor.text.length : end;
  return true;
};

const commandStart = (tokens: readonly Token[]): boolean => {
  const last = tokens[tokens.length - 1];
  return last === undefined || last.kind === "op";
};

const next = (cursor: Cursor, tokens: Token[], cmd: boolean): void => {
  if (skipComment(cursor)) return;
  const redirect = REDIRECT.exec(cursor.text.slice(cursor.pos, cursor.pos + 5));
  if (redirect !== null) {
    cursor.pos += redirect[0].length;
    while (peek(cursor) === " ") cursor.pos += 1;
    const target = redirect[3] ?? word(cursor, cmd).text;
    tokens.push({ kind: "redirect", op: redirect[2] ?? ">", fd: redirect[1] ?? "", target, body: undefined });
    return;
  }
  const op = OPERATORS.find((candidate) => cursor.text.startsWith(candidate, cursor.pos));
  if (op !== undefined || (cmd && peek(cursor) === "&")) {
    const text = op ?? "&";
    cursor.pos += text.length;
    tokens.push({ kind: "op", text });
    return;
  }
  if ((peek(cursor) === "&" || peek(cursor) === ".") && peek(cursor, 1) === " " && commandStart(tokens)) {
    cursor.pos += 2;
    return;
  }
  tokens.push(word(cursor, cmd));
};

export const lexPowerShell = (text: string, cmd = false): Lexed => {
  const cursor = cursorOf(text.replace(/\r\n/g, "\n"));
  const tokens: Token[] = [];
  const skip = (): void => {
    while (peek(cursor) === " " || peek(cursor) === "\t") cursor.pos += 1;
  };
  skip();
  while (!atEnd(cursor)) {
    next(cursor, tokens, cmd);
    skip();
  }
  return { tokens, substitutions: cursor.subs, incomplete: cursor.incomplete };
};

const ALIASES: Readonly<Record<string, string>> = {
  ri: "remove-item",
  rm: "remove-item",
  rmdir: "remove-item",
  del: "remove-item",
  erase: "remove-item",
  rd: "remove-item",
  cd: "set-location",
  chdir: "set-location",
  sl: "set-location",
  pushd: "push-location",
};

export const powershellProgram = (name: string): string => ALIASES[name.toLowerCase()] ?? name.toLowerCase();
