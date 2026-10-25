export interface Cursor {
  readonly text: string;
  pos: number;
  incomplete: boolean;
  readonly subs: string[];
}

export const cursorOf = (text: string): Cursor => ({ text, pos: 0, incomplete: false, subs: [] });

export const peek = (cursor: Cursor, offset = 0): string => cursor.text.charAt(cursor.pos + offset);

export const atEnd = (cursor: Cursor): boolean => cursor.pos >= cursor.text.length;

const skipQuoted = (cursor: Cursor, quote: string): void => {
  cursor.pos += 1;
  while (!atEnd(cursor) && peek(cursor) !== quote) {
    cursor.pos += quote === '"' && peek(cursor) === "\\" ? 2 : 1;
  }
  cursor.pos += 1;
};

export const readBalanced = (cursor: Cursor, open: string, close: string): string => {
  const start = cursor.pos;
  let depth = 1;
  while (!atEnd(cursor)) {
    const char = peek(cursor);
    if (char === "\\") cursor.pos += 2;
    else if (char === "'" || char === '"') skipQuoted(cursor, char);
    else {
      if (char === open) depth += 1;
      if (char === close) depth -= 1;
      if (depth === 0) {
        const inner = cursor.text.slice(start, cursor.pos);
        cursor.pos += 1;
        return inner;
      }
      cursor.pos += 1;
    }
  }
  cursor.incomplete = true;
  return cursor.text.slice(start);
};

export const readUntil = (cursor: Cursor, terminator: string, escapes: boolean): string => {
  let out = "";
  while (!atEnd(cursor) && peek(cursor) !== terminator) {
    if (escapes && peek(cursor) === "\\" && cursor.pos + 1 < cursor.text.length) {
      out += peek(cursor, 1);
      cursor.pos += 2;
    } else {
      out += peek(cursor);
      cursor.pos += 1;
    }
  }
  if (atEnd(cursor)) cursor.incomplete = true;
  cursor.pos += 1;
  return out;
};

const ANSI: Readonly<Record<string, string>> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "\\": "\\",
  "'": "'",
  '"': '"',
  e: "\u001b",
};

export const readAnsiC = (cursor: Cursor): string => {
  let out = "";
  while (!atEnd(cursor) && peek(cursor) !== "'") {
    if (peek(cursor) === "\\") {
      const next = peek(cursor, 1);
      const hex = /^x([0-9a-fA-F]{1,2})/.exec(cursor.text.slice(cursor.pos + 1, cursor.pos + 4));
      if (hex !== null) {
        out += String.fromCharCode(Number.parseInt(hex[1] ?? "0", 16));
        cursor.pos += 1 + hex[0].length;
        continue;
      }
      out += ANSI[next] ?? next;
      cursor.pos += 2;
    } else {
      out += peek(cursor);
      cursor.pos += 1;
    }
  }
  if (atEnd(cursor)) cursor.incomplete = true;
  cursor.pos += 1;
  return out;
};
