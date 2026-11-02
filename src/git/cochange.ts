import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";

export const COCHANGE_FEATURE = "cochange";
export const MAX_COMMITS = 2000;
export const BULK_FILES = 30;
export const MIN_SUPPORT = 4;
export const MIN_CONFIDENCE = 0.75;
export const HALF_LIFE_DAYS = 180;
export const RECENT_SHARE = 0.5;
const DAY_S = 86_400;
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
  readonly time?: number;
}

const headerOf = (line: string | undefined): { readonly hash: string; readonly time?: number } | undefined => {
  const match = /^([0-9a-f]{7,64})(?: (\d+))?$/.exec(line?.trim() ?? "");
  if (match?.[1] === undefined) return undefined;
  return match[2] === undefined ? { hash: match[1] } : { hash: match[1], time: Number(match[2]) };
};

export const parseLog = (text: string): readonly Commit[] =>
  text
    .split("\u0000")
    .map((block) => block.trim().split("\n"))
    .flatMap(([first, ...files]): Commit[] => {
      const header = headerOf(first);
      return header === undefined
        ? []
        : [{ ...header, files: files.map((file) => file.trim()).filter((file) => file !== "") }];
    });

export interface Partner {
  readonly file: string;
  readonly partner: string;
  readonly support: number;
  readonly confidence: number;
  readonly recentSupport: number;
  readonly commits: readonly string[];
}

export interface CochangeOptions {
  readonly minSupport: number;
  readonly minConfidence: number;
  readonly bulkFiles: number;
  readonly halfLifeDays: number;
}

export const DEFAULT_OPTIONS: CochangeOptions = {
  minSupport: MIN_SUPPORT,
  minConfidence: MIN_CONFIDENCE,
  bulkFiles: BULK_FILES,
  halfLifeDays: HALF_LIFE_DAYS,
};

export const decayWeight = (time: number | undefined, reference: number | undefined, halfLifeDays: number): number =>
  time === undefined || reference === undefined || halfLifeDays <= 0
    ? 1
    : 0.5 ** (Math.max(0, reference - time) / (halfLifeDays * DAY_S));

const round2 = (value: number): number => Math.round(value * 100) / 100;

export const usable = (commits: readonly Commit[], bulkFiles: number): readonly Commit[] =>
  commits
    .map((commit) => ({ ...commit, files: commit.files.filter((file) => !isIgnored(file)) }))
    .filter((commit) => commit.files.length >= 2 && commit.files.length <= bulkFiles);

const partnersOf = (
  file: string,
  withFile: readonly Commit[],
  weight: (commit: Commit) => number,
  options: CochangeOptions,
): readonly Partner[] => {
  const total = withFile.reduce((sum, commit) => sum + weight(commit), 0);
  const counts = new Map<string, Commit[]>();
  for (const commit of withFile) {
    for (const other of commit.files) if (other !== file) counts.set(other, [...(counts.get(other) ?? []), commit]);
  }
  return [...counts].flatMap(([partner, shared]): Partner[] => {
    const recent = shared.reduce((sum, commit) => sum + weight(commit), 0);
    const confidence = total === 0 ? 0 : recent / total;
    if (shared.length < options.minSupport || confidence < options.minConfidence) return [];
    if (recent < options.minSupport * RECENT_SHARE) return [];
    return [
      {
        file,
        partner,
        support: shared.length,
        confidence: round2(confidence),
        recentSupport: round2(recent),
        commits: shared.slice(0, MAX_EVIDENCE).map((commit) => commit.hash),
      },
    ];
  });
};

export const missingPartners = (
  commits: readonly Commit[],
  touched: readonly string[],
  options: CochangeOptions = DEFAULT_OPTIONS,
): readonly Partner[] => {
  const kept = usable(commits, options.bulkFiles);
  const times = kept.flatMap((commit) => (commit.time === undefined ? [] : [commit.time]));
  const reference = times.length === 0 ? undefined : Math.max(...times);
  const weight = (commit: Commit): number => decayWeight(commit.time, reference, options.halfLifeDays);
  const set = new Set(touched);
  return touched
    .filter((item) => !isIgnored(item))
    .flatMap((file) => {
      const withFile = kept.filter((commit) => commit.files.includes(file));
      return withFile.length < options.minSupport ? [] : partnersOf(file, withFile, weight, options);
    })
    .filter((item) => !set.has(item.partner))
    .sort((left, right) => right.support - left.support);
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
