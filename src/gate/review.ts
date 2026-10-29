import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";

export const REVIEWS_FILE = "reviews.json";
export const REVIEWER_AGENT = /(^|:)[\w-]*reviewer$/i;
const KEEP = 50;

export const REVIEW_VERDICTS = ["approve", "approve-with-changes", "request-changes", "fail"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];
export const APPROVING: ReadonlySet<ReviewVerdict> = new Set(["approve", "approve-with-changes"]);

export interface Review {
  readonly treeHash: string;
  readonly agent: string;
  readonly at: string;
  readonly verdict?: ReviewVerdict;
}

const verdictOf = (value: unknown): ReviewVerdict | undefined => REVIEW_VERDICTS.find((item) => item === value);

const toReview = (value: unknown): Review | undefined => {
  if (!isRecord(value)) return undefined;
  const { treeHash, agent, at } = value;
  const verdict = verdictOf(value["verdict"]);
  return typeof treeHash === "string" && typeof agent === "string" && typeof at === "string"
    ? { treeHash, agent, at, ...(verdict === undefined ? {} : { verdict }) }
    : undefined;
};

const FENCED = /```[a-z]*\r?\n([\s\S]*?)```/g;

const parsedVerdict = (text: string): ReviewVerdict | undefined => {
  const parsed = parseJsonObject(text.trim());
  return parsed.ok ? verdictOf(parsed.value["verdict"]) : undefined;
};

export const reviewVerdict = (message: string): ReviewVerdict | undefined => {
  const blocks = [...message.matchAll(FENCED)].map((match) => match[1] ?? "");
  const found = [...blocks, message].map(parsedVerdict).filter((item) => item !== undefined);
  return found[found.length - 1];
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
  verdict?: ReviewVerdict,
): boolean => {
  const review: Review = { treeHash, agent, at: runtime.now(), ...(verdict === undefined ? {} : { verdict }) };
  const reviews = [...readReviews(runtime, paths), review].slice(-KEEP);
  return writeJsonFile(runtime, paths.cache(REVIEWS_FILE), { reviews: reviews.map((review) => ({ ...review })) }).ok;
};
