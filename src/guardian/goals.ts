import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml } from "../core/yaml/parse.js";
import type { YamlValue } from "../core/yaml/scalar.js";
import { stringifyYaml } from "../core/yaml/write.js";

export const GOALS_FILE = ".finitemonkey/goals.yml";
export const GOALS_SCHEMA = "finitemonkey/goals@1";
export const GOAL_KINDS = ["goals", "constraints", "non_goals", "done", "rejected"] as const;
export const ORIGINS = ["stated", "inferred"] as const;

export type GoalKind = (typeof GOAL_KINDS)[number];
export type Origin = (typeof ORIGINS)[number];

export interface GoalEntry {
  readonly id: string;
  readonly kind: GoalKind;
  readonly text: string;
  readonly origin: Origin;
}

export interface Goals {
  readonly entries: readonly GoalEntry[];
  readonly extra: Readonly<Record<string, YamlValue>>;
}

export const EMPTY_GOALS: Goals = { entries: [], extra: {} };

export const goalsPath = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(root, GOALS_FILE));

const entryOf = (kind: GoalKind, value: unknown): GoalEntry | undefined => {
  if (!isRecord(value)) return undefined;
  const { id, text } = value;
  if (typeof id !== "string" || typeof text !== "string" || id.trim() === "" || text.trim() === "") return undefined;
  const origin = value["origin"] === "stated" ? "stated" : "inferred";
  return { id: id.trim(), kind, text: text.trim(), origin };
};

export const parseGoals = (text: string): Goals => {
  const parsed = parseYaml(text);
  if (!parsed.ok || !isRecord(parsed.value)) return EMPTY_GOALS;
  const tree = parsed.value;
  const entries = GOAL_KINDS.flatMap((kind) => {
    const list = tree[kind];
    return Array.isArray(list) ? list.flatMap((item: unknown) => entryOf(kind, item) ?? []) : [];
  });
  const known = new Set<string>([...GOAL_KINDS, "schema"]);
  const extra = Object.fromEntries(Object.entries(tree).filter(([key]) => !known.has(key)));
  return { entries, extra };
};

export const readGoals = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): Goals => {
  const text = runtime.readText(goalsPath(root));
  return text.ok ? parseGoals(text.value) : EMPTY_GOALS;
};

export const renderGoals = (goals: Goals): string => {
  const sections = Object.fromEntries(
    GOAL_KINDS.flatMap((kind): [string, YamlValue][] => {
      const items = goals.entries.filter((entry) => entry.kind === kind);
      return items.length === 0
        ? []
        : [[kind, items.map((entry) => ({ id: entry.id, text: entry.text, origin: entry.origin }))]];
    }),
  );
  return stringifyYaml({ schema: GOALS_SCHEMA, ...sections, ...goals.extra });
};

export const writeGoals = (
  runtime: Pick<Runtime, "writeText" | "mkdir">,
  root: AbsolutePath,
  goals: Goals,
): boolean => {
  const made = runtime.mkdir(toAbsolutePath(join(root, ".finitemonkey")));
  return made.ok && runtime.writeText(goalsPath(root), renderGoals(goals)).ok;
};

export const statedGoals = (goals: Goals): readonly GoalEntry[] =>
  goals.entries.filter((entry) => entry.kind === "goals" && entry.origin === "stated");

const PREFIX: Readonly<Record<GoalKind, string>> = {
  goals: "g",
  constraints: "c",
  non_goals: "n",
  done: "d",
  rejected: "r",
};

export const nextGoalId = (goals: Goals, kind: GoalKind): string => {
  const prefix = PREFIX[kind];
  const used = goals.entries.flatMap((entry) => {
    const match = new RegExp(`^${prefix}(\\d+)$`).exec(entry.id);
    return match?.[1] === undefined ? [] : [Number.parseInt(match[1], 10)];
  });
  return `${prefix}${String(Math.max(0, ...used) + 1)}`;
};
