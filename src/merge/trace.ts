import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import type { HunkReport, HunkTrace, LineRange } from "./report.js";
import type { ResolvedHunk, Stages } from "./resolve-file.js";
import { splitLines } from "./segments.js";

const MAX_COMMITS = 5;

const indexFrom = (lines: readonly string[], needle: readonly string[], from: number): number => {
  for (let start = from; start + needle.length <= lines.length; start += 1) {
    if (needle.every((line, offset) => lines[start + offset] === line)) return start;
  }
  return -1;
};

const locate = (lines: readonly string[], needle: readonly string[], from: number, before?: string): LineRange => {
  if (needle.length > 0) {
    const at = indexFrom(lines, needle, from);
    return { start: (at < 0 ? from : at) + 1, count: needle.length };
  }
  const anchor = before === undefined ? -1 : indexFrom(lines, [before], from);
  return { start: (anchor < 0 ? from : anchor + 1) + 1, count: 0 };
};

export const commitsTouching = (
  runtime: Runtime,
  dir: AbsolutePath,
  base: string,
  tip: string,
  path: string,
): readonly string[] => {
  const result = runtime.gitWith(
    ["log", `--max-count=${String(MAX_COMMITS)}`, "--format=%h %s", `${base}..${tip}`, "--", path],
    dir,
    {},
  );
  return result.ok ? result.stdout.split("\n").filter((line) => line !== "") : [];
};

export interface TraceSides {
  readonly oursCommits: readonly string[];
  readonly theirsCommits: readonly string[];
}

export const traceHunks = (
  stages: Stages,
  hunks: readonly ResolvedHunk[],
  sides: TraceSides,
  decide: (hunk: ResolvedHunk) => string,
): readonly HunkReport[] => {
  const texts = {
    base: splitLines(stages.base ?? ""),
    ours: splitLines(stages.ours ?? ""),
    theirs: splitLines(stages.theirs ?? ""),
  };
  const cursor = { base: 0, ours: 0, theirs: 0 };
  return hunks.map((hunk, index) => {
    const range = (side: keyof typeof cursor): LineRange => {
      const found = locate(texts[side], hunk.segment[side], cursor[side], hunk.before);
      cursor[side] = found.start - 1 + found.count;
      return found;
    };
    const trace: HunkTrace = {
      base: range("base"),
      ours: range("ours"),
      theirs: range("theirs"),
      oursCommits: sides.oursCommits,
      theirsCommits: sides.theirsCommits,
    };
    return { index: index + 1, class: hunk.verdict.cls, rule: hunk.verdict.rule, decision: decide(hunk), trace };
  });
};
