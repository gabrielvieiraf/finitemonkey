import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import {
  ADVISOR_RULES,
  type AdvisorRule,
  type CommandRun,
  isRule,
  isState,
  PERSON_MUTE_AFTER,
  RETIRE_MIN_SHOWN,
  RETIRE_RATE,
  type Suggestion,
  SUGGESTIONS_FILE,
} from "./types.js";

export const suggestionsPath = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(root, SUGGESTIONS_FILE));

const text = (record: Readonly<Record<string, unknown>>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

const number = (record: Readonly<Record<string, unknown>>, key: string): number | undefined => {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
};

const runsOf = (value: unknown): readonly CommandRun[] | undefined =>
  Array.isArray(value)
    ? value.flatMap((item: unknown): CommandRun[] => {
        if (!isRecord(item) || typeof item["command"] !== "string") return [];
        const code = item["exitCode"];
        return [{ command: item["command"], exitCode: typeof code === "number" ? code : null }];
      })
    : undefined;

const optional = (record: Readonly<Record<string, unknown>>): Partial<Suggestion> => {
  const before = runsOf(record["before"]);
  const after = number(record, "after");
  const example = text(record, "example");
  const by = text(record, "by");
  const refactorTask = text(record, "refactorTask");
  return {
    ...(example === undefined ? {} : { example }),
    ...(by === undefined ? {} : { by }),
    ...(refactorTask === undefined ? {} : { refactorTask }),
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  };
};

export const parseSuggestion = (line: string): Suggestion | undefined => {
  const parsed = parseJsonObject(line);
  if (!parsed.ok) return undefined;
  const record = parsed.value;
  const [id, at, task, file, name, metric, refactoring] = [
    "id",
    "at",
    "task",
    "file",
    "name",
    "metric",
    "refactoring",
  ].map((key) => text(record, key));
  const [lineNo, value, target, score] = ["line", "value", "target", "score"].map((key) => number(record, key));
  const { rule, state } = record;
  if (id === undefined || at === undefined || task === undefined || file === undefined || name === undefined)
    return undefined;
  if (metric === undefined || refactoring === undefined || !isRule(rule) || !isState(state)) return undefined;
  if (lineNo === undefined || value === undefined || target === undefined || score === undefined) return undefined;
  return {
    id,
    at,
    task,
    rule,
    file,
    line: lineNo,
    name,
    metric,
    value,
    target,
    refactoring,
    score,
    state,
    ...optional(record),
  };
};

export const readHistory = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): readonly Suggestion[] => {
  const raw = runtime.readText(suggestionsPath(root));
  if (!raw.ok) return [];
  return raw.value.split("\n").flatMap((line) => {
    const item = line.trim() === "" ? undefined : parseSuggestion(line);
    return item === undefined ? [] : [item];
  });
};

export const latest = (history: readonly Suggestion[]): readonly Suggestion[] => {
  const byId = new Map<string, Suggestion>();
  for (const item of history) byId.set(item.id, item);
  return [...byId.values()];
};

export const appendSuggestions = (
  runtime: Pick<Runtime, "appendText" | "mkdir">,
  root: AbsolutePath,
  items: readonly Suggestion[],
): boolean => {
  if (items.length === 0) return true;
  runtime.mkdir(toAbsolutePath(join(root, ".finitemonkey")));
  return runtime.appendText(suggestionsPath(root), items.map((item) => `${JSON.stringify(item)}\n`).join("")).ok;
};

export const nextId = (current: readonly Suggestion[]): string => {
  const top = current.reduce((max, item) => Math.max(max, Number(item.id.replace(/^S/, "")) || 0), 0);
  return `S${String(top + 1)}`;
};

export const mutedFor = (current: readonly Suggestion[], person: string): ReadonlySet<AdvisorRule> =>
  new Set(
    ADVISOR_RULES.filter(
      (rule) =>
        current.filter((item) => item.rule === rule && item.state === "dismissed" && item.by === person).length >=
        PERSON_MUTE_AFTER,
    ),
  );

export interface RuleRate {
  readonly rule: AdvisorRule;
  readonly shown: number;
  readonly dismissed: number;
  readonly retired: boolean;
}

export const ruleRates = (current: readonly Suggestion[]): readonly RuleRate[] =>
  ADVISOR_RULES.map((rule) => {
    const shown = current.filter((item) => item.rule === rule).length;
    const dismissed = current.filter((item) => item.rule === rule && item.state === "dismissed").length;
    return { rule, shown, dismissed, retired: shown >= RETIRE_MIN_SHOWN && dismissed / shown > RETIRE_RATE };
  });

export const dismissedSpots = (current: readonly Suggestion[]): ReadonlySet<string> =>
  new Set(current.filter((item) => item.state === "dismissed").map((item) => `${item.rule}\u0000${item.file}`));
