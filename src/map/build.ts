import { join, posix } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { gitAt, treeHash } from "../gate/git.js";
import { configAt, loadProjectConfig } from "../git/project-config.js";
import { fmPaths } from "../task/paths.js";
import type { Definition } from "./defs.js";
import { astGrepDefinitions, astGrepFound, grepDefinitions } from "./sources.js";

export const MAP_FILE = "map.txt";
export const DEFAULT_MAP_BUDGET = 4000;
export const SHARED_FOLDERS = ["lib", "utils", "services", "components", "hooks", "api"] as const;

export type MapSource = "ast-grep" | "git-grep";

export interface CodeMap {
  readonly text: string;
  readonly tree: string;
  readonly budget: number;
  readonly source: MapSource;
  readonly cached: boolean;
  readonly folders: number;
  readonly shown: number;
}

const HEADER = /^# finitemonkey map tree=(\S+) budget=(\d+) source=(ast-grep|git-grep) folders=(\d+) shown=(\d+)\n/;
const MORE_RESERVE = 40;

const rank = (folder: string): number => {
  const segments = folder.split("/");
  const index = SHARED_FOLDERS.findIndex((name) => segments.includes(name));
  return index === -1 ? SHARED_FOLDERS.length : index;
};

const grouped = (definitions: readonly Definition[]): readonly (readonly [string, readonly string[]])[] => {
  const folders = new Map<string, Set<string>>();
  for (const { file, name } of definitions) {
    const folder = posix.dirname(file);
    folders.set(folder, (folders.get(folder) ?? new Set()).add(name));
  }
  return [...folders]
    .map(([folder, names]) => [folder, [...names].sort((a, b) => a.localeCompare(b))] as const)
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
};

const fitLine = (folder: string, names: readonly string[], room: number): string | undefined => {
  let line = `${folder}: ${names[0] ?? ""}`;
  if (line.length > room) return undefined;
  for (const name of names.slice(1)) {
    if (line.length + name.length + 2 > room) return line;
    line = `${line}, ${name}`;
  }
  return line;
};

export const renderMap = (
  definitions: readonly Definition[],
  budget: number,
): { text: string; folders: number; shown: number } => {
  const folders = grouped(definitions);
  const lines: string[] = [];
  let used = 0;
  for (const [folder, names] of folders) {
    const line = fitLine(folder, names, budget - used - MORE_RESERVE - 1);
    if (line === undefined) break;
    lines.push(line);
    used += line.length + 1;
  }
  const hidden = folders.length - lines.length;
  const tail = hidden > 0 ? [`… ${String(hidden)} more folders`] : [];
  return { text: [...lines, ...tail].join("\n"), folders: folders.length, shown: lines.length };
};

export const mapBudget = (runtime: Runtime, root: AbsolutePath, override: number | undefined): number => {
  if (override !== undefined) return override;
  const value = configAt(loadProjectConfig(runtime, root), "map", "budget");
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAP_BUDGET;
};

export const mapPath = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(fmPaths(root).dir, MAP_FILE));

const headerOf = (map: Omit<CodeMap, "text" | "cached">): string =>
  `# finitemonkey map tree=${map.tree} budget=${String(map.budget)} source=${map.source} folders=${String(map.folders)} shown=${String(map.shown)}\n`;

const fromCache = (runtime: Runtime, root: AbsolutePath, tree: string, budget: number): CodeMap | undefined => {
  const text = runtime.readText(mapPath(root));
  if (!text.ok) return undefined;
  const match = HEADER.exec(text.value);
  if (match?.[1] !== tree || Number(match[2]) !== budget) return undefined;
  return {
    text: text.value.slice(match[0].length).replace(/\n$/, ""),
    tree,
    budget,
    source: match[3] === "ast-grep" ? "ast-grep" : "git-grep",
    cached: true,
    folders: Number(match[4]),
    shown: Number(match[5]),
  };
};

const definitionsOf = (
  runtime: Runtime,
  root: AbsolutePath,
): { source: MapSource; definitions: readonly Definition[] } => {
  if (!astGrepFound(runtime)) return { source: "git-grep", definitions: grepDefinitions(runtime, root, false) };
  return {
    source: "ast-grep",
    definitions: [...astGrepDefinitions(runtime, root), ...grepDefinitions(runtime, root, true)],
  };
};

export const buildMap = (runtime: Runtime, root: AbsolutePath, budget: number): CodeMap | undefined => {
  const tree = treeHash(gitAt(runtime, root));
  if (tree === undefined) return undefined;
  const cached = fromCache(runtime, root, tree, budget);
  if (cached !== undefined) return cached;
  const { source, definitions } = definitionsOf(runtime, root);
  const rendered = renderMap(definitions, budget);
  const map: CodeMap = { ...rendered, tree, budget, source, cached: false };
  const made = runtime.mkdir(fmPaths(root).dir);
  if (made.ok) runtime.writeText(mapPath(root), `${headerOf(map)}${map.text}\n`);
  return map;
};
