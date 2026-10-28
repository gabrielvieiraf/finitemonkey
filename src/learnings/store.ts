import { createHash } from "node:crypto";
import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { maskText } from "../mask/mask.js";

export const LEARNINGS_FILE = "learnings.jsonl";
export const STATS_FILE = "learnings-stats.json";
export const LESSON_SOURCES = ["signature", "correction", "advisor", "person"] as const;
export const EXPIRE_DAYS = 90;
export const EXPIRE_UNHELPFUL = 2;
const DAY_MS = 86_400_000;
const MAX_TEXT = 300;

export type LessonSource = (typeof LESSON_SOURCES)[number];

export interface Lesson {
  readonly id: string;
  readonly text: string;
  readonly paths: readonly string[];
  readonly sig: string | undefined;
  readonly source: LessonSource;
  readonly createdAt: string;
  readonly lastMatchedAt: string | undefined;
  readonly uses: number;
  readonly unhelpful: number;
}

export interface LessonStats {
  readonly expired: number;
  readonly deleted: number;
}

export const learningsPath = (dir: AbsolutePath): AbsolutePath => toAbsolutePath(join(dir, LEARNINGS_FILE));
const statsPath = (dir: AbsolutePath): AbsolutePath => toAbsolutePath(join(dir, "cache", STATS_FILE));

const text = (raw: JsonObject, key: string): string | undefined => {
  const value = raw[key];
  return typeof value === "string" && value !== "" ? value : undefined;
};

const count = (raw: JsonObject, key: string): number => {
  const value = raw[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
};

const parseLesson = (raw: JsonObject): Lesson | undefined => {
  const id = text(raw, "id");
  const body = text(raw, "text");
  const source = LESSON_SOURCES.find((item) => item === raw["source"]);
  const paths = raw["paths"];
  if (id === undefined || body === undefined || source === undefined) return undefined;
  return {
    id,
    text: body,
    paths: Array.isArray(paths) ? paths.filter((item): item is string => typeof item === "string") : [],
    sig: text(raw, "sig"),
    source,
    createdAt: text(raw, "createdAt") ?? "",
    lastMatchedAt: text(raw, "lastMatchedAt"),
    uses: count(raw, "uses"),
    unhelpful: count(raw, "unhelpful"),
  };
};

export const readLessons = (runtime: Pick<Runtime, "readText">, dir: AbsolutePath): readonly Lesson[] => {
  const raw = runtime.readText(learningsPath(dir));
  if (!raw.ok) return [];
  return raw.value.split("\n").flatMap((line) => {
    const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
    const lesson = parsed?.ok === true ? parseLesson(parsed.value) : undefined;
    return lesson === undefined ? [] : [lesson];
  });
};

export const writeLessons = (
  runtime: Pick<Runtime, "writeText">,
  dir: AbsolutePath,
  lessons: readonly Lesson[],
): boolean => runtime.writeText(learningsPath(dir), lessons.map((lesson) => `${JSON.stringify(lesson)}\n`).join("")).ok;

export const readStats = (runtime: Pick<Runtime, "readText">, dir: AbsolutePath): LessonStats => {
  const raw = runtime.readText(statsPath(dir));
  const parsed = raw.ok ? parseJsonObject(raw.value) : undefined;
  return parsed?.ok === true
    ? { expired: count(parsed.value, "expired"), deleted: count(parsed.value, "deleted") }
    : { expired: 0, deleted: 0 };
};

export const bumpStats = (
  runtime: Pick<Runtime, "readText" | "writeText" | "mkdir">,
  dir: AbsolutePath,
  change: Partial<LessonStats>,
): void => {
  const before = readStats(runtime, dir);
  runtime.mkdir(toAbsolutePath(join(dir, "cache")));
  runtime.writeText(
    statsPath(dir),
    `${JSON.stringify({ expired: before.expired + (change.expired ?? 0), deleted: before.deleted + (change.deleted ?? 0) })}\n`,
  );
};

export const isExpired = (lesson: Lesson, now: string, days: number = EXPIRE_DAYS): boolean => {
  if (lesson.unhelpful >= EXPIRE_UNHELPFUL) return true;
  const since = Date.parse(lesson.lastMatchedAt ?? lesson.createdAt);
  return Number.isFinite(since) && Date.parse(now) - since > days * DAY_MS;
};

export const pruneLessons = (
  runtime: Pick<Runtime, "readText" | "writeText" | "mkdir" | "now">,
  dir: AbsolutePath,
  days: number = EXPIRE_DAYS,
): { readonly kept: readonly Lesson[]; readonly expired: readonly Lesson[] } => {
  const lessons = readLessons(runtime, dir);
  const now = runtime.now();
  const expired = lessons.filter((lesson) => isExpired(lesson, now, days));
  const kept = lessons.filter((lesson) => !isExpired(lesson, now, days));
  if (expired.length > 0) {
    writeLessons(runtime, dir, kept);
    bumpStats(runtime, dir, { expired: expired.length });
  }
  return { kept, expired };
};

export const lessonId = (body: string, key: string): string =>
  createHash("sha256").update(`${key}\0${body}`, "utf8").digest("hex").slice(0, 8);

export const newLesson = (input: Pick<Lesson, "text" | "paths" | "sig" | "source">, now: string): Lesson => {
  const body = maskText(input.text).slice(0, MAX_TEXT);
  return {
    id: lessonId(body, `${input.sig ?? ""}|${input.paths.join(",")}`),
    text: body,
    paths: input.paths,
    sig: input.sig,
    source: input.source,
    createdAt: now,
    lastMatchedAt: undefined,
    uses: 0,
    unhelpful: 0,
  };
};
