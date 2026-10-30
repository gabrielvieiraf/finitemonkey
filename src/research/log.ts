import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";

export const RESEARCH_LOG_SCHEMA = "finitemonkey/research-log@1";
export const CHANGES = ["nothing", "option", "unknown"] as const;
export const RISKS = ["normal", "high"] as const;
export const QUIET_RUN = 2;

export type Change = (typeof CHANGES)[number];
export const STANCES = ["favors", "contests", "unrelated"] as const;
export type Stance = (typeof STANCES)[number];
export type StanceBy = "person" | "model";
export type Risk = (typeof RISKS)[number];

export interface ResearchQuestion {
  readonly question: string;
  readonly decision: string;
  readonly options: readonly string[];
  readonly criteria: readonly string[];
  readonly unknowns: readonly string[];
  readonly stop: string;
  readonly risk: Risk;
  readonly at: string;
}

export interface ResearchSource {
  readonly url: string;
  readonly changed: Change;
  readonly target: string;
  readonly resolves: string;
  readonly at: string;
  readonly stance?: Stance;
  readonly stanceBy?: StanceBy;
  readonly claim?: string;
}

export interface EmptySearch {
  readonly unknown: string;
  readonly queries: readonly string[];
  readonly places: readonly string[];
  readonly at: string;
}

export interface ResearchLog {
  readonly slug: string;
  readonly question: ResearchQuestion;
  readonly sources: readonly ResearchSource[];
  readonly emptySearches: readonly EmptySearch[];
  readonly closedAt?: string;
}

export interface ResearchState {
  readonly openUnknowns: readonly string[];
  readonly quietRun: number;
  readonly suggestStop: boolean;
}

export const researchLogPath = (paths: FmPaths, slug: string): AbsolutePath =>
  toAbsolutePath(join(paths.dir, "research", `${slug}.jsonl`));

const text = (record: JsonObject, key: string): string => {
  const value = record[key];
  return typeof value === "string" ? value : "";
};

const texts = (record: JsonObject, key: string): readonly string[] => {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
};

const questionOf = (record: JsonObject): ResearchQuestion => ({
  question: text(record, "question"),
  decision: text(record, "decision"),
  options: texts(record, "options"),
  criteria: texts(record, "criteria"),
  unknowns: texts(record, "unknowns"),
  stop: text(record, "stop"),
  risk: RISKS.find((item) => item === record["risk"]) ?? "normal",
  at: text(record, "at"),
});

const sourceOf = (record: JsonObject): ResearchSource => {
  const stance = STANCES.find((item) => item === record["stance"]);
  const claim = text(record, "claim");
  return {
    url: text(record, "url"),
    changed: CHANGES.find((item) => item === record["changed"]) ?? "nothing",
    target: text(record, "target"),
    resolves: text(record, "resolves"),
    at: text(record, "at"),
    ...(stance === undefined ? {} : { stance, stanceBy: record["stanceBy"] === "person" ? "person" : "model" }),
    ...(claim === "" ? {} : { claim }),
  };
};

const confirmed = (sources: readonly ResearchSource[], records: readonly JsonObject[]): readonly ResearchSource[] =>
  sources.map((source) => {
    const confirmation = records.findLast((record) => record["type"] === "stance" && record["url"] === source.url);
    const stance = STANCES.find((item) => item === confirmation?.["stance"]);
    return stance === undefined ? source : { ...source, stance, stanceBy: "person" };
  });

const emptyOf = (record: JsonObject): EmptySearch => ({
  unknown: text(record, "unknown"),
  queries: texts(record, "queries"),
  places: texts(record, "places"),
  at: text(record, "at"),
});

export const readResearchLog = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  slug: string,
): ResearchLog | undefined => {
  const content = runtime.readText(researchLogPath(paths, slug));
  if (!content.ok) return undefined;
  const records = content.value.split("\n").flatMap((line) => {
    const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
    return parsed?.ok === true && isRecord(parsed.value) ? [parsed.value] : [];
  });
  const head = records.find((record) => record["type"] === "question");
  if (head === undefined) return undefined;
  const closed = records.findLast((record) => record["type"] === "close");
  return {
    slug,
    question: questionOf(head),
    sources: confirmed(records.filter((record) => record["type"] === "source").map(sourceOf), records),
    emptySearches: records.filter((record) => record["type"] === "empty-search").map(emptyOf),
    ...(closed === undefined ? {} : { closedAt: text(closed, "at") }),
  };
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export const resolvedBy = (log: ResearchLog, unknown: string): number =>
  new Set(log.sources.filter((source) => source.resolves === unknown).map((source) => hostOf(source.url))).size;

export const researchState = (log: ResearchLog): ResearchState => {
  const needed = log.question.risk === "high" ? 2 : 1;
  const openUnknowns = log.question.unknowns.filter((unknown) => resolvedBy(log, unknown) < needed);
  const lastChange = log.sources.findLastIndex((source) => source.changed !== "nothing");
  const quietRun = log.sources.length - 1 - lastChange;
  return { openUnknowns, quietRun, suggestStop: quietRun >= QUIET_RUN && openUnknowns.length === 0 };
};

export const appendResearch = (
  runtime: Pick<Runtime, "appendText" | "mkdir">,
  paths: FmPaths,
  slug: string,
  record: JsonObject,
): boolean =>
  runtime.mkdir(toAbsolutePath(join(paths.dir, "research"))).ok &&
  runtime.appendText(researchLogPath(paths, slug), `${JSON.stringify(record)}\n`).ok;
