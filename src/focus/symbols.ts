import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { matchesAny } from "../core/glob.js";
import type { Runtime } from "../core/runtime.js";
import { MAP_FILE } from "../map/build.js";
import { fmPaths } from "../task/paths.js";
import type { Deviation } from "./scope.js";

export type SymbolIndex = ReadonlyMap<string, readonly string[]>;

const LINE = /^([^\s:#…][^:]*): (.+)$/;
const NAME = /^[A-Za-z_$][\w$]*$/;

export const parseMapIndex = (text: string): SymbolIndex => {
  const index = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    const match = LINE.exec(line);
    const folder = match?.[1];
    if (folder === undefined) continue;
    for (const name of (match?.[2] ?? "").split(", ")) {
      if (!NAME.test(name)) continue;
      index.set(name, [...(index.get(name) ?? []), folder]);
    }
  }
  return index;
};

export const readSymbolIndex = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): SymbolIndex => {
  const text = runtime.readText(toAbsolutePath(join(fmPaths(root).dir, MAP_FILE)));
  return text.ok ? parseMapIndex(text.value) : new Map();
};

const CODE_SPAN = /`([A-Za-z_$][\w$.]*)(?:\(\))?`/g;
const CALL = /\b([A-Za-z_$][\w$]*)\(\)/g;
const SHAPED = /\b([a-z_$][\w$]*[A-Z][\w$]*|[A-Z][a-z0-9]+[A-Z][\w$]*|[a-z][a-z0-9]*_[a-z0-9_]+)\b/g;
const MIN_LENGTH = 4;

export const symbolTokens = (prompt: string): readonly string[] => {
  const spans = [...prompt.matchAll(CODE_SPAN)].map((match) => (match[1] ?? "").split(".").at(-1) ?? "");
  const calls = [...prompt.matchAll(CALL)].map((match) => match[1] ?? "");
  const shaped = [...prompt.matchAll(SHAPED)].map((match) => match[1] ?? "");
  return [...new Set([...spans, ...calls, ...shaped])].filter((name) => name.length >= MIN_LENGTH);
};

const scopeGlobs = (paths: readonly string[]): readonly string[] =>
  paths.flatMap((path) => (path.endsWith("/") ? [path, `${path}**`] : [path, `${path}/**`]));

const folderInScope = (folder: string, scope: readonly string[]): boolean =>
  matchesAny(folder, scopeGlobs(scope)) || scope.some((path) => path.startsWith(`${folder}/`));

export const symbolDeviations = (
  prompt: string,
  index: SymbolIndex,
  scope: readonly string[],
): readonly Deviation[] => {
  if (scope.length === 0 || index.size === 0) return [];
  return symbolTokens(prompt).flatMap((name) => {
    const folders = index.get(name) ?? [];
    if (folders.length === 0 || folders.some((folder) => folderInScope(folder, scope))) return [];
    const folder = folders[0] ?? "";
    return [
      { file: `${name} (${folder})`, area: folder.includes("/") ? folder.slice(0, folder.indexOf("/")) : folder },
    ];
  });
};
