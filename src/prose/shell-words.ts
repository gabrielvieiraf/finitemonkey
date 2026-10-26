const HEREDOC = /<<-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g;
const HEREDOC_REF = /<<__FM_HEREDOC_(\d+)__/;
const SEPARATOR = /[;&|\n]/;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WRAPPERS = new Set(["sudo", "command", "exec", "time", "nice", "nohup", "builtin", "env"]);

export interface ShellSegment {
  readonly program: string;
  readonly args: readonly string[];
}

export interface ShellWords {
  readonly segments: readonly ShellSegment[];
  readonly heredocs: readonly string[];
}

const liftHeredocs = (command: string): { readonly text: string; readonly heredocs: readonly string[] } => {
  const heredocs: string[] = [];
  const text = command.replace(HEREDOC, (_match, _quote: string, _tag: string, body: string) => {
    heredocs.push(body);
    return `<<__FM_HEREDOC_${String(heredocs.length - 1)}__`;
  });
  return { text, heredocs };
};

interface Scan {
  words: string[];
  segments: string[][];
  word: string | undefined;
}

const endWord = (scan: Scan): void => {
  if (scan.word !== undefined) scan.words.push(scan.word);
  scan.word = undefined;
};

const endSegment = (scan: Scan): void => {
  endWord(scan);
  if (scan.words.length > 0) scan.segments.push(scan.words);
  scan.words = [];
};

const quotedEnd = (text: string, from: number, quote: string): number => {
  let index = from;
  while (index < text.length && text[index] !== quote) index += quote === '"' && text[index] === "\\" ? 2 : 1;
  return index;
};

const unescape = (value: string): string => value.replace(/\\(["\\$`])/g, "$1");

const splitWords = (text: string): readonly string[][] => {
  const scan: Scan = { words: [], segments: [], word: undefined };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (char === '"' || char === "'") {
      const end = quotedEnd(text, index + 1, char);
      const inner = text.slice(index + 1, end);
      scan.word = (scan.word ?? "") + (char === '"' ? unescape(inner) : inner);
      index = end;
    } else if (char === "\\" && index + 1 < text.length) {
      scan.word = (scan.word ?? "") + (text[index + 1] === "\n" ? "" : (text[index + 1] ?? ""));
      index += 1;
    } else if (SEPARATOR.test(char)) {
      endSegment(scan);
    } else if (/\s/.test(char)) {
      endWord(scan);
    } else {
      scan.word = (scan.word ?? "") + char;
    }
  }
  endSegment(scan);
  return scan.segments;
};

const segmentOf = (words: readonly string[]): ShellSegment | undefined => {
  let index = 0;
  while (index < words.length && (ASSIGNMENT.test(words[index] ?? "") || WRAPPERS.has(words[index] ?? ""))) index += 1;
  const program = words[index];
  if (program === undefined) return undefined;
  return { program: program.split(/[\\/]/).pop() ?? program, args: words.slice(index + 1) };
};

export const shellWords = (command: string): ShellWords => {
  const { text, heredocs } = liftHeredocs(command);
  const segments = splitWords(text).flatMap((words) => {
    const segment = segmentOf(words);
    return segment === undefined ? [] : [segment];
  });
  return { segments, heredocs };
};

export const heredocIn = (value: string, heredocs: readonly string[]): string | undefined => {
  const index = HEREDOC_REF.exec(value)?.[1];
  return index === undefined ? undefined : heredocs[Number(index)];
};
