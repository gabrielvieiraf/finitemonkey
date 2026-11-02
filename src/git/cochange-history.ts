import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { Git } from "../gate/git.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { BULK_FILES, type Commit, MAX_COMMITS, parseLog, usable } from "./cochange.js";

const CACHE_FILE = "cochange.json";
const CACHE_VERSION = 2;
const LOG_FORMAT = "--format=%x00%H %ct";

interface CachedHistory {
  readonly head: string;
  readonly commits: readonly Commit[];
}

const commitOf = (item: unknown): Commit[] => {
  if (!isRecord(item) || typeof item["hash"] !== "string" || !Array.isArray(item["files"])) return [];
  const files = item["files"].filter((file): file is string => typeof file === "string");
  const time = item["time"];
  return [typeof time === "number" ? { hash: item["hash"], files, time } : { hash: item["hash"], files }];
};

const readCached = (runtime: Pick<Runtime, "readText">, paths: FmPaths): CachedHistory | undefined => {
  const cached = readJsonFile(runtime, paths.cache(CACHE_FILE));
  if (cached?.["version"] !== CACHE_VERSION || typeof cached["head"] !== "string") return undefined;
  return Array.isArray(cached["commits"])
    ? { head: cached["head"], commits: cached["commits"].flatMap(commitOf) }
    : undefined;
};

const sinceCached = (git: Git, cached: CachedHistory | undefined, head: string): readonly string[] =>
  cached !== undefined && git.out(["merge-base", "--is-ancestor", cached.head, head]) !== undefined
    ? [`${cached.head}..${head}`]
    : [];

export const historyOf = (
  runtime: Pick<Runtime, "readText" | "writeText">,
  paths: FmPaths,
  git: Git,
): readonly Commit[] => {
  const head = git.out(["rev-parse", "HEAD"])?.trim();
  if (head === undefined || head === "") return [];
  const cached = readCached(runtime, paths);
  if (cached?.head === head) return cached.commits;
  const range = sinceCached(git, cached, head);
  const text = git.out(["log", "--no-merges", "-n", String(MAX_COMMITS), "--name-only", LOG_FORMAT, ...range]) ?? "";
  const fresh = usable(parseLog(text), BULK_FILES);
  const commits =
    range.length === 0 || cached === undefined ? fresh : [...fresh, ...cached.commits].slice(0, MAX_COMMITS);
  writeJsonFile(runtime, paths.cache(CACHE_FILE), {
    version: CACHE_VERSION,
    head,
    commits: commits.map((commit) => ({
      hash: commit.hash,
      files: [...commit.files],
      ...(commit.time === undefined ? {} : { time: commit.time }),
    })),
  });
  return commits;
};
