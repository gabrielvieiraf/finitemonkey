import { isAbsolute, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";

export const N_PLUS_ONE_MIN = 5;
const STATEMENT = /\b(select|insert|update|delete|with)\b[\s\S]*$/i;

export interface RepeatedQuery {
  readonly shape: string;
  readonly count: number;
}

export interface QueryCount {
  readonly total: number;
  readonly repeated: readonly RepeatedQuery[];
}

export interface QueryLog {
  readonly mark: () => number;
  readonly since: (mark: number) => QueryCount;
}

export const queryShape = (sql: string): string =>
  sql
    .replace(/'(?:[^']|'')*'/g, "?")
    .replace(/"(?:[^"\\]|\\.)*"/g, (quoted) => (/^"\w+"$/.test(quoted) ? quoted : "?"))
    .replace(/\$\d+|:\w+|@\w+/g, "?")
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/\(\s*\?(?:\s*,\s*\?)*\s*\)/g, "(?)")
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*$/, "")
    .trim()
    .toLowerCase();

export const statementsOf = (text: string): readonly string[] =>
  text.split(/\r?\n/).flatMap((line) => {
    const match = STATEMENT.exec(line);
    return match === null ? [] : [match[0]];
  });

export const countQueries = (text: string, min = N_PLUS_ONE_MIN): QueryCount => {
  const statements = statementsOf(text);
  const counts = new Map<string, number>();
  for (const statement of statements) {
    const shape = queryShape(statement);
    counts.set(shape, (counts.get(shape) ?? 0) + 1);
  }
  const repeated = [...counts.entries()]
    .filter(([, count]) => count >= min)
    .map(([shape, count]) => ({ shape, count }))
    .sort((left, right) => right.count - left.count || left.shape.localeCompare(right.shape));
  return { total: statements.length, repeated };
};

export const queryLogPath = (root: AbsolutePath, file: string): AbsolutePath =>
  toAbsolutePath(isAbsolute(file) ? file : join(root, file));

export const fileQueryLog = (runtime: Pick<Runtime, "readText">, path: AbsolutePath): QueryLog => {
  const read = (): string => {
    const text = runtime.readText(path);
    return text.ok ? text.value : "";
  };
  return {
    mark: () => read().length,
    since: (mark) => {
      const text = read();
      return countQueries(text.length < mark ? text : text.slice(mark));
    },
  };
};
