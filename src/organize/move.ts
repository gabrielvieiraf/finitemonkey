import { addedByContent } from "../core/line-diff.js";
import { isTestFile } from "../guards/tests/patterns.js";

export interface FileChange {
  readonly path: string;
  readonly before: string | undefined;
  readonly after: string | undefined;
}

export interface LogicLine {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface ReExport {
  readonly file: string;
  readonly names: readonly string[];
  readonly from: string;
}

const IGNORABLE = [
  /^$/,
  /^(?:\/\/|#|\/\*|\*)/,
  /^import\b/,
  /^from\s+\S+\s+import\b/,
  /^export\s*(?:\*|\{)/,
  /^[)\]}]+[;,]?$/,
  /^(?:"use strict"|'use strict');?$/,
  /^package\s/,
] as const;

const RE_EXPORT = /^export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/;

export const normalizeLine = (line: string): string =>
  line
    .trim()
    .replace(/^export\s+(?:default\s+)?(?=(?:async\s+)?function|class|const|let|var|interface|type|enum)/, "")
    .replace(/\s+/g, " ");

const ignorable = (line: string): boolean => IGNORABLE.some((pattern) => pattern.test(line));

export const newLogic = (changes: readonly FileChange[]): readonly LogicLine[] => {
  const source = changes.filter((change) => !isTestFile(change.path));
  const removed = new Map<string, number>();
  for (const change of source) {
    for (const item of addedByContent(change.after ?? "", change.before ?? "")) {
      const key = normalizeLine(item.text);
      if (!ignorable(key)) removed.set(key, (removed.get(key) ?? 0) + 1);
    }
  }
  return source.flatMap((change) =>
    addedByContent(change.before, change.after ?? "").flatMap((item): LogicLine[] => {
      const key = normalizeLine(item.text);
      if (ignorable(key)) return [];
      const left = removed.get(key) ?? 0;
      if (left > 0) {
        removed.set(key, left - 1);
        return [];
      }
      return [{ file: change.path, line: item.line, text: item.text.trim() }];
    }),
  );
};

const reExportsIn = (file: string, lines: readonly string[]): readonly ReExport[] =>
  lines.flatMap((line): ReExport[] => {
    const match = RE_EXPORT.exec(line.trim());
    if (match === null) return [];
    const names = (match[1] ?? "")
      .split(",")
      .map(
        (name) =>
          name
            .trim()
            .split(/\s+as\s+/)
            .pop() ?? "",
      )
      .filter((name) => name !== "");
    return [{ file, names, from: match[2] ?? "" }];
  });

export const removedReExports = (changes: readonly FileChange[]): readonly ReExport[] =>
  changes.flatMap((change) =>
    reExportsIn(
      change.path,
      addedByContent(change.after ?? "", change.before ?? "").map((item) => item.text),
    ),
  );
