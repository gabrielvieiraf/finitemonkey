import { withoutCarriageReturn } from "../core/posix-path.js";
import { scanText } from "./engine.js";
import { locate, type LocatedFinding } from "./located.js";

export interface DiffScanner {
  readonly push: (line: string) => void;
  readonly end: () => readonly LocatedFinding[];
}

interface FileChunk {
  file: string | undefined;
  inHunk: boolean;
  next: number;
  text: string[];
  lines: number[];
}

const COMMIT = /^commit ([0-9a-f]{7,64})\b/;
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const DEV_NULL = "/dev/null";

const fresh = (): FileChunk => ({ file: undefined, inHunk: false, next: 0, text: [], lines: [] });

const targetOf = (line: string): string | undefined => {
  const path = line.slice(4).replace(/\t.*$/, "");
  if (path === DEV_NULL) return undefined;
  return path.startsWith("b/") ? path.slice(2) : path;
};

const collect = (chunk: FileChunk, commit: string | undefined, found: Map<string, LocatedFinding>): void => {
  const { file } = chunk;
  if (file === undefined || chunk.text.length === 0) return;
  for (const finding of scanText(chunk.text.join("\n"), { path: file })) {
    const located = locate(finding, file, chunk.lines[finding.line - 1] ?? finding.line, commit);
    found.set(located.id, located);
  }
};

const addLine = (chunk: FileChunk, line: string): void => {
  const hunk = HUNK.exec(line);
  if (hunk !== null) {
    chunk.inHunk = true;
    chunk.next = Number(hunk[1]);
  } else if (!chunk.inHunk && line.startsWith("+++ ")) {
    chunk.file = targetOf(line);
  } else if (chunk.inHunk && line.startsWith("+")) {
    chunk.text.push(line.slice(1));
    chunk.lines.push(chunk.next);
    chunk.next += 1;
  } else if (chunk.inHunk && line.startsWith(" ")) {
    chunk.next += 1;
  }
};

export const diffScanner = (): DiffScanner => {
  const found = new Map<string, LocatedFinding>();
  let commit: string | undefined;
  let chunk = fresh();
  const flush = (): void => {
    collect(chunk, commit, found);
    chunk = fresh();
  };
  const header = (line: string): boolean => {
    const match = COMMIT.exec(line);
    if (match !== null) {
      flush();
      commit = match[1];
      return true;
    }
    if (line.startsWith("diff --git ")) {
      flush();
      return true;
    }
    return false;
  };
  return {
    push: (raw) => {
      const line = withoutCarriageReturn(raw);
      if (!header(line)) addLine(chunk, line);
    },
    end: () => {
      flush();
      return [...found.values()];
    },
  };
};
