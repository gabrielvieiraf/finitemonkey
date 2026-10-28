import { posix } from "node:path";

import { importEdges } from "../arch/imports.js";
import { workingTree } from "../arch/scan.js";
import type { AbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { type Git, treeHash } from "../gate/git.js";
import { isTestFile } from "../guards/tests/patterns.js";
import { fileMetrics } from "../quality/metrics.js";
import { loadTypescript } from "../quality/ts-api.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { readHistory } from "./history.js";
import { branchComplexity, type FileFacts, type Hotspot, isRankable, rankHotspots } from "./rank.js";

const CACHE = "organize-rank.json";
const JS = /\.(?:[cm]?[jt]sx?)$/;

const stemOf = (path: string): string =>
  posix
    .basename(path)
    .replace(/\.[^.]+$/, "")
    .replace(/(?:\.test|\.spec|_test|Test|Tests)$/, "")
    .replace(/^test_/, "")
    .toLowerCase();

const complexityOf = (root: AbsolutePath, path: string, text: string): number => {
  const ts = JS.test(path) ? loadTypescript(root) : undefined;
  if (ts === undefined) return branchComplexity(text);
  return 1 + fileMetrics(ts, path, text).functions.reduce((sum, fn) => sum + fn.cognitive, 0);
};

export const projectFacts = (runtime: Runtime, git: Git, root: AbsolutePath): readonly FileFacts[] => {
  const tree = workingTree(runtime, git, root, []);
  const tested = new Set(tree.files.filter(isTestFile).map(stemOf));
  const importers = new Map<string, Set<string>>();
  for (const edge of importEdges(tree)) importers.set(edge.to, (importers.get(edge.to) ?? new Set()).add(edge.from));
  return tree.files.filter(isRankable).flatMap((path): FileFacts[] => {
    const text = tree.read(path);
    if (text === undefined) return [];
    return [
      {
        path,
        lines: text.split("\n").length,
        complexity: complexityOf(root, path, text),
        importers: importers.get(path)?.size ?? 0,
        hasTest: tested.has(stemOf(path)),
      },
    ];
  });
};

const NUMBERS = ["score", "churn", "complexity", "lines", "importers", "fixes"] as const;

const hotspotFrom = (value: unknown): Hotspot | undefined => {
  if (!isRecord(value) || typeof value["path"] !== "string") return undefined;
  const numbers = NUMBERS.map((key) => value[key]);
  if (!numbers.every((item): item is number => typeof item === "number")) return undefined;
  const [score = 0, churn = 0, complexity = 0, lines = 0, importers = 0, fixes = 0] = numbers;
  return {
    path: value["path"],
    score,
    churn,
    complexity,
    lines,
    importers,
    fixes,
    hasTest: value["hasTest"] === true,
    sensitive: value["sensitive"] === true,
  };
};

const cached = (runtime: Runtime, paths: FmPaths, key: string): readonly Hotspot[] | undefined => {
  const raw = readJsonFile(runtime, paths.cache(CACHE));
  const list = raw?.["key"] === key ? raw["hotspots"] : undefined;
  if (!Array.isArray(list)) return undefined;
  const parsed = list.map(hotspotFrom);
  return parsed.every((item): item is Hotspot => item !== undefined) ? parsed : undefined;
};

export const hotspots = (
  runtime: Runtime,
  git: Git,
  paths: FmPaths,
  sensitive: readonly string[],
): readonly Hotspot[] | undefined => {
  const history = readHistory(git);
  const tree = treeHash(git);
  if (history === undefined || tree === undefined) return undefined;
  const key = `${tree}\u0000${sensitive.join(",")}`;
  const hit = cached(runtime, paths, key);
  if (hit !== undefined) return hit;
  const ranked = rankHotspots(projectFacts(runtime, git, paths.root), history, sensitive);
  writeJsonFile(runtime, paths.cache(CACHE), { key, hotspots: ranked.map((item) => ({ ...item })) });
  return ranked;
};
