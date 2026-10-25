import { withoutCarriageReturn } from "../../core/posix-path.js";
import type { FileDiff, FileStatus, Hunk } from "./types.js";

interface Draft {
  oldPath: string | undefined;
  newPath: string | undefined;
  status: FileStatus;
  binary: boolean;
  hunks: Hunk[];
  current: { oldStart: number; oldCount: number; newStart: number; removed: string[]; added: string[] } | undefined;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const BINARY = /^Binary files (?:a\/(.+)|\/dev\/null) and (?:b\/(.+)|\/dev\/null) differ$/;

const pathAfter = (line: string, prefix: string): string | undefined => {
  const value = line.slice(prefix.length).replace(/\t$/, "");
  return value === "/dev/null" ? undefined : value.replace(/^[ab]\//, "");
};

const flushHunk = (draft: Draft): void => {
  if (draft.current !== undefined) draft.hunks.push(draft.current);
  draft.current = undefined;
};

const finish = (draft: Draft | undefined, out: FileDiff[]): void => {
  if (draft === undefined) return;
  flushHunk(draft);
  out.push({
    oldPath: draft.oldPath,
    newPath: draft.newPath,
    status: draft.status,
    binary: draft.binary,
    hunks: draft.hunks,
  });
};

const headerLine = (draft: Draft, line: string): void => {
  if (line.startsWith("new file mode")) draft.status = "added";
  else if (line.startsWith("deleted file mode")) draft.status = "deleted";
  else if (line.startsWith("rename from ")) {
    draft.status = "renamed";
    draft.oldPath = line.slice("rename from ".length);
  } else if (line.startsWith("rename to ")) draft.newPath = line.slice("rename to ".length);
  else if (line.startsWith("copy from ")) {
    draft.status = "copied";
    draft.oldPath = line.slice("copy from ".length);
  } else if (line.startsWith("copy to ")) draft.newPath = line.slice("copy to ".length);
  else if (line.startsWith("--- ")) draft.oldPath = pathAfter(line, "--- ");
  else if (line.startsWith("+++ ")) draft.newPath = pathAfter(line, "+++ ");
  else {
    const binary = BINARY.exec(line);
    if (binary === null) return;
    draft.binary = true;
    draft.oldPath = binary[1];
    draft.newPath = binary[2];
  }
};

const bodyLine = (draft: Draft, line: string): void => {
  const hunk = HUNK.exec(line);
  if (hunk !== null) {
    flushHunk(draft);
    draft.current = {
      oldStart: Number(hunk[1]),
      oldCount: hunk[2] === undefined ? 1 : Number(hunk[2]),
      newStart: Number(hunk[3]),
      removed: [],
      added: [],
    };
    return;
  }
  if (draft.current === undefined) {
    headerLine(draft, line);
    return;
  }
  if (line.startsWith("-")) draft.current.removed.push(line.slice(1));
  else if (line.startsWith("+")) draft.current.added.push(line.slice(1));
};

const DIFF_GIT = /^diff --git a\/(.+) b\/(.+)$/;

export const parseUnifiedDiff = (text: string): readonly FileDiff[] => {
  const out: FileDiff[] = [];
  let draft: Draft | undefined;
  for (const raw of text.split("\n")) {
    const line = withoutCarriageReturn(raw);
    const start = DIFF_GIT.exec(line);
    if (start !== null) {
      finish(draft, out);
      draft = {
        oldPath: start[1],
        newPath: start[2],
        status: "modified",
        binary: false,
        hunks: [],
        current: undefined,
      };
    } else if (draft !== undefined) bodyLine(draft, line);
  }
  finish(draft, out);
  return out;
};

export const DIFF_ARGS = [
  "-c",
  "core.quotePath=false",
  "diff",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--histogram",
  "-M",
  "-C",
  "--unified=0",
  "--ignore-space-at-eol",
  "--src-prefix=a/",
  "--dst-prefix=b/",
] as const;
