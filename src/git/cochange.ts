import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { Git } from "../gate/git.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";

export const COCHANGE_FEATURE = "cochange";
export const MAX_COMMITS = 2000;
export const BULK_FILES = 30;
export const MIN_SUPPORT = 4;
export const MIN_CONFIDENCE = 0.75;
const CACHE_FILE = "cochange.json";
const DISMISSED_FILE = "cochange-dismissed.json";
const MAX_EVIDENCE = 5;

const IGNORED = [
  /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|go\.sum|Pipfile\.lock)$/,
  /(?:^|\/)(?:CHANGELOG|CHANGES|HISTORY|NEWS)(?:\.[\w.]+)?$/i,
  /(?:^|\/)(?:dist|build|out|vendor|node_modules|coverage)\//,
  /\.(?:min\.js|map|snap|lock)$/,
  /(?:^|\/)\.finitemonkey\//,
];

export const isIgnored = (path: string): boolean => IGNORED.some((pattern) => pattern.test(path));

export interface Commit {
  readonly hash: string;
  readonly files: readonly string[];
}

export const parseLog = (text: string): readonly Commit[] =>
  text
    .split("\u0000")
    .map((block) => block.trim().split("\n"))
    .flatMap(([hash, ...files]): Commit[] =>
      hash === undefined || !/^[0-9a-f]{7,64}$/.test(hash)
        ? []
        : [{ hash, files: files.map((file) => file.trim()).filter((file) => file !== "") }],
    );

export interface Partner {
  readonly file: string;
  readonly partner: string;
  readonly support: number;
  readonly confidence: number;
  readonly commits: readonly string[];
}

export interface CochangeOptions {
  readonly minSupport: number;
  readonly minConfidence: number;
  readonly bulkFiles: number;
}

export const DEFAULT_OPTIONS: CochangeOptions = {
  minSupport: MIN_SUPPORT,
  minConfidence: MIN_CONFIDENCE,
  bulkFiles: BULK_FILES,
};

export const usable = (commits: readonly Commit[], bulkFiles: number): readonly Commit[] =>
  commits
    .map((commit) => ({ ...commit, files: commit.files.filter((file) => !isIgnored(file)) }))
    .filter((commit) => commit.files.length >= 2 && commit.files.length <= bulkFiles);

export const missingPartners = (
  commits: readonly Commit[],
  touched: readonly string[],
  options: CochangeOptions = DEFAULT_OPTIONS,
): readonly Partner[] => {
  const kept = usable(commits, options.bulkFiles);
  const set = new Set(touched);
  const found: Partner[] = [];
  for (const file of touched.filter((item) => !isIgnored(item))) {
    const withFile = kept.filter((commit) => commit.files.includes(file));
    if (withFile.length < options.minSupport) continue;
    const counts = new Map<string, string[]>();
    for (const commit of withFile) {
      for (const other of commit.files) {
        if (other !== file) counts.set(other, [...(counts.get(other) ?? []), commit.hash]);
      }
    }
    for (const [partner, hashes] of counts) {
      const confidence = hashes.length / withFile.length;
      if (set.has(partner) || hashes.length < options.minSupport || confidence < options.minConfidence) continue;
      found.push({
        file,
        partner,
        support: hashes.length,
        confidence: Math.round(confidence * 100) / 100,
        commits: hashes.slice(0, MAX_EVIDENCE),
      });
    }
  }
  return found.sort((left, right) => right.support - left.support);
};

export const historyOf = (
  runtime: Pick<Runtime, "readText" | "writeText">,
  paths: FmPaths,
  git: Git,
): readonly Commit[] => {
  const head = git.out(["rev-parse", "HEAD"])?.trim();
  if (head === undefined || head === "") return [];
  const cached = readJsonFile(runtime, paths.cache(CACHE_FILE));
  if (cached?.["head"] === head && Array.isArray(cached["commits"])) {
    return cached["commits"].flatMap((item): Commit[] =>
      isRecord(item) && typeof item["hash"] === "string" && Array.isArray(item["files"])
        ? [{ hash: item["hash"], files: item["files"].filter((file): file is string => typeof file === "string") }]
        : [],
    );
  }
  const text = git.out(["log", "--no-merges", "-n", String(MAX_COMMITS), "--name-only", "--format=%x00%H"]) ?? "";
  const commits = usable(parseLog(text), BULK_FILES);
  writeJsonFile(runtime, paths.cache(CACHE_FILE), {
    head,
    commits: commits.map((commit) => ({ hash: commit.hash, files: [...commit.files] })),
  });
  return commits;
};

export const pairKey = (left: string, right: string): string => [left, right].sort().join("\u0000");

export interface Dismissal {
  readonly reason: string;
  readonly support: number;
}

export const readDismissed = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
): Readonly<Record<string, Dismissal>> => {
  const raw = readJsonFile(runtime, paths.cache(DISMISSED_FILE));
  return Object.fromEntries(
    Object.entries(raw ?? {}).flatMap(([key, value]): [string, Dismissal][] =>
      isRecord(value) && typeof value["reason"] === "string" && typeof value["support"] === "number"
        ? [[key, { reason: value["reason"], support: value["support"] }]]
        : [],
    ),
  );
};

export const supportOf = (commits: readonly Commit[], left: string, right: string): number =>
  commits.filter((commit) => commit.files.includes(left) && commit.files.includes(right)).length;

export const dismissPair = (
  runtime: Pick<Runtime, "readText" | "writeText">,
  paths: FmPaths,
  commits: readonly Commit[],
  pair: readonly [string, string],
  reason: string,
): Dismissal => {
  const dismissal = { reason, support: supportOf(commits, pair[0], pair[1]) };
  writeJsonFile(runtime, paths.cache(DISMISSED_FILE), {
    ...readDismissed(runtime, paths),
    [pairKey(pair[0], pair[1])]: dismissal,
  });
  return dismissal;
};

export const notDismissed = (
  partners: readonly Partner[],
  dismissed: Readonly<Record<string, Dismissal>>,
): readonly Partner[] =>
  partners.filter((item) => dismissed[pairKey(item.file, item.partner)]?.support !== item.support);
