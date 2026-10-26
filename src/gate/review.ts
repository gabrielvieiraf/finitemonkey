import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";

export const REVIEWS_FILE = "reviews.json";
export const REVIEWER_AGENT = /(^|:)[\w-]*reviewer$/i;
const KEEP = 50;

export interface Review {
  readonly treeHash: string;
  readonly agent: string;
  readonly at: string;
}

const toReview = (value: unknown): Review | undefined => {
  if (!isRecord(value)) return undefined;
  const { treeHash, agent, at } = value;
  return typeof treeHash === "string" && typeof agent === "string" && typeof at === "string"
    ? { treeHash, agent, at }
    : undefined;
};

export const readReviews = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly Review[] => {
  const raw = readJsonFile(runtime, paths.cache(REVIEWS_FILE))?.["reviews"];
  return Array.isArray(raw)
    ? raw.flatMap((item: unknown) => {
        const review = toReview(item);
        return review === undefined ? [] : [review];
      })
    : [];
};

export const recordReview = (
  runtime: Pick<Runtime, "readText" | "writeText" | "now">,
  paths: FmPaths,
  treeHash: string,
  agent: string,
): boolean => {
  const reviews = [...readReviews(runtime, paths), { treeHash, agent, at: runtime.now() }].slice(-KEEP);
  return writeJsonFile(runtime, paths.cache(REVIEWS_FILE), { reviews: reviews.map((review) => ({ ...review })) }).ok;
};
