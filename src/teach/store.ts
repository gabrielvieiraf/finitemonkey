import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { oneOf } from "../judge/types.js";
import type { FmPaths } from "../task/paths.js";
import {
  TEACH_FILE,
  TEACH_ORIGINS,
  TEACH_PROPOSERS,
  type TeachAnswer,
  type TeachEntry,
  type TeachExplanation,
  type TeachQuestion,
  type TeachSkip,
} from "./types.js";

export const teachPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, TEACH_FILE));

const str = (record: JsonObject, key: string): string | undefined =>
  typeof record[key] === "string" ? record[key] : undefined;

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const optional = (record: JsonObject, keys: readonly string[]): Readonly<Record<string, string>> =>
  Object.fromEntries(
    keys.flatMap((key) => {
      const value = str(record, key);
      return value === undefined ? [] : [[key, value]];
    }),
  );

const questionOf = (raw: JsonObject, id: string, at: string): TeachQuestion | undefined => {
  const [run, input, key] = [str(raw, "run"), str(raw, "input"), str(raw, "key")];
  const origin = oneOf(TEACH_ORIGINS, raw["origin"]);
  const inputFrom = oneOf(TEACH_PROPOSERS, raw["inputFrom"]) ?? "template";
  if (run === undefined || input === undefined || key === undefined || origin === undefined) return undefined;
  const concepts = strings(raw["concepts"]);
  return {
    type: "question",
    id,
    at,
    concepts,
    run,
    input,
    key,
    origin,
    inputFrom,
    ...optional(raw, ["task", "session"]),
  };
};

const answerOf = (raw: JsonObject, id: string, at: string): TeachAnswer | undefined => {
  const [question, answer] = [str(raw, "question"), str(raw, "answer")];
  if (question === undefined || answer === undefined || typeof raw["correct"] !== "boolean") return undefined;
  return { type: "answer", id, at, question, answer, correct: raw["correct"] };
};

const explanationOf = (raw: JsonObject, id: string, at: string): TeachExplanation | undefined => {
  const text = str(raw, "text");
  if (text === undefined) return undefined;
  const from = raw["from"] === "terminal" ? "terminal" : "session";
  return {
    type: "explanation",
    id,
    at,
    concepts: strings(raw["concepts"]),
    text,
    from,
    ...optional(raw, ["question"]),
  };
};

const skipOf = (raw: JsonObject, id: string, at: string): TeachSkip | undefined => {
  const question = str(raw, "question");
  return question === undefined ? undefined : { type: "skip", id, at, question };
};

const PARSERS: Readonly<
  Record<TeachEntry["type"], (raw: JsonObject, id: string, at: string) => TeachEntry | undefined>
> = { question: questionOf, answer: answerOf, explanation: explanationOf, skip: skipOf };

const entryOf = (line: string): TeachEntry | undefined => {
  const parsed = parseJsonObject(line);
  if (!parsed.ok || !isRecord(parsed.value)) return undefined;
  const raw = parsed.value;
  const [id, at] = [str(raw, "id"), str(raw, "at")];
  const type = oneOf(["question", "answer", "explanation", "skip"] as const, raw["type"]);
  if (id === undefined || at === undefined || type === undefined) return undefined;
  return PARSERS[type](raw, id, at);
};

export const readTeach = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly TeachEntry[] => {
  const text = runtime.readText(teachPath(paths));
  if (!text.ok) return [];
  return text.value.split("\n").flatMap((line) => {
    const entry = line.trim() === "" ? undefined : entryOf(line);
    return entry === undefined ? [] : [entry];
  });
};

export const appendTeach = (
  runtime: Pick<Runtime, "appendText" | "mkdir">,
  paths: FmPaths,
  entry: TeachEntry,
): boolean => {
  runtime.mkdir(paths.dir);
  return runtime.appendText(teachPath(paths), `${JSON.stringify(entry)}\n`).ok;
};

export const questionsIn = (entries: readonly TeachEntry[]): readonly TeachQuestion[] =>
  entries.filter((entry): entry is TeachQuestion => entry.type === "question");

export const settledOf = (question: string, entries: readonly TeachEntry[]): TeachAnswer | TeachSkip | undefined =>
  entries.find(
    (entry): entry is TeachAnswer | TeachSkip =>
      (entry.type === "answer" || entry.type === "skip") && entry.question === question,
  );
