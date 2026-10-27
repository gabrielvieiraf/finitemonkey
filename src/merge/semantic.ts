import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { definitionsIn, type Language, languageOf } from "../gate/callers/languages.js";
import { callSites, removedSymbols } from "../gate/callers/scan.js";
import { changedFiles, gitAt } from "../gate/git.js";
import type { SemanticCandidate } from "./report.js";

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

const names = (runtime: Runtime, dir: AbsolutePath, args: readonly string[]): readonly string[] => {
  const result = runtime.gitWith(args, dir, {});
  return result.ok ? result.stdout.split("\n").filter((line) => line !== "") : [];
};

const enclosing = (language: Language, lines: readonly string[], line: number): string | undefined => {
  for (let index = Math.min(line, lines.length) - 1; index >= 0; index -= 1) {
    const found = [...definitionsIn(language, lines[index] ?? "")][0];
    if (found !== undefined) return found;
  }
  return undefined;
};

const touched = (runtime: Runtime, dir: AbsolutePath, base: string, tip: string, path: string): ReadonlySet<string> => {
  const language = languageOf(path);
  if (language === undefined) return new Set();
  const text = runtime.gitWith(["cat-file", "blob", `${tip}:${path}`], dir, {}).stdout.split("\n");
  const diff = runtime.gitWith(["diff", "-U0", "--no-color", base, tip, "--", path], dir, {}).stdout;
  const symbols = new Set<string>();
  for (const header of diff.split("\n")) {
    const match = HUNK_HEADER.exec(header);
    if (match === null) continue;
    const start = Number(match[1] ?? "0");
    const count = Number(match[2] ?? "1");
    for (let line = start; line < start + Math.max(count, 1); line += 1) {
      const name = enclosing(language, text, line);
      if (name !== undefined) symbols.add(name);
    }
  }
  return symbols;
};

export const sameSymbolBothSides = (
  runtime: Runtime,
  dir: AbsolutePath,
  base: string,
  ours: string,
  theirs: string,
  conflicted: ReadonlySet<string>,
): readonly SemanticCandidate[] => {
  const left = new Set(names(runtime, dir, ["diff", "--name-only", base, ours]));
  const both = names(runtime, dir, ["diff", "--name-only", base, theirs]).filter(
    (path) => left.has(path) && !conflicted.has(path),
  );
  return both.flatMap((path) => {
    const fromOurs = touched(runtime, dir, base, ours, path);
    return [...touched(runtime, dir, base, theirs, path)]
      .filter((name) => fromOurs.has(name))
      .map((symbol) => ({ file: path, symbol, reason: "changed on both sides; merged clean" }));
  });
};

export const openCallers = (runtime: Runtime, dir: AbsolutePath, base: string): readonly SemanticCandidate[] => {
  const git = gitAt(runtime, dir);
  const removed = removedSymbols(runtime, git, base, changedFiles(git, base));
  return callSites(runtime, git, removed).map((site) => ({
    file: `${site.file}:${String(site.line)}`,
    symbol: site.name,
    reason: "removed or renamed on one side, still called after the merge",
  }));
};
