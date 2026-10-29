import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { FmPaths } from "../task/paths.js";

export const ASSUMPTIONS_LOG = "assumptions.jsonl";
export const LEVELS3 = ["low", "medium", "high"] as const;
export const ASSUMPTION_STATUSES = ["unverified", "verified", "false", "review"] as const;
export const TRIGGER_KINDS = ["date", "file", "event"] as const;

export type Level3 = (typeof LEVELS3)[number];
export type AssumptionStatus = (typeof ASSUMPTION_STATUSES)[number];
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export interface Trigger {
  readonly kind: TriggerKind;
  readonly value: string;
  readonly hash?: string;
}

export interface Assumption {
  readonly id: string;
  readonly text: string;
  readonly source: string;
  readonly impact: Level3;
  readonly breaks: string;
  readonly confidence: Level3;
  readonly verify: string;
  readonly status: AssumptionStatus;
  readonly at: string;
  readonly trigger?: Trigger;
}

export const assumptionsPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, ASSUMPTIONS_LOG));

const pick = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.find((option) => option === value) ?? fallback;

const text = (record: JsonObject, key: string): string => {
  const value = record[key];
  return typeof value === "string" ? value : "";
};

const triggerOf = (value: unknown): Trigger | undefined => {
  if (!isRecord(value)) return undefined;
  const kind = TRIGGER_KINDS.find((item) => item === value["kind"]);
  const target = text(value, "value");
  const hash = text(value, "hash");
  return kind === undefined || target === "" ? undefined : { kind, value: target, ...(hash === "" ? {} : { hash }) };
};

const assumptionOf = (record: JsonObject): Assumption | undefined => {
  const id = text(record, "id");
  const body = text(record, "text");
  if (id === "" || body === "") return undefined;
  const trigger = triggerOf(record["trigger"]);
  return {
    id,
    text: body,
    source: text(record, "source"),
    impact: pick(LEVELS3, record["impact"], "medium"),
    breaks: text(record, "breaks"),
    confidence: pick(LEVELS3, record["confidence"], "medium"),
    verify: text(record, "verify"),
    status: pick(ASSUMPTION_STATUSES, record["status"], "unverified"),
    at: text(record, "at"),
    ...(trigger === undefined ? {} : { trigger }),
  };
};

export const readAssumptions = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly Assumption[] => {
  const content = runtime.readText(assumptionsPath(paths));
  if (!content.ok) return [];
  return content.value.split("\n").flatMap((line) => {
    const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
    const item = parsed?.ok === true ? assumptionOf(parsed.value) : undefined;
    return item === undefined ? [] : [item];
  });
};

export const writeAssumptions = (
  runtime: Pick<Runtime, "writeText" | "mkdir">,
  paths: FmPaths,
  list: readonly Assumption[],
): boolean =>
  runtime.mkdir(paths.dir).ok &&
  runtime.writeText(assumptionsPath(paths), list.map((item) => `${JSON.stringify(item)}\n`).join("")).ok;

export const fileHash = (runtime: Pick<Runtime, "readText">, root: AbsolutePath, file: string): string => {
  const content = runtime.readText(toAbsolutePath(join(root, file)));
  return content.ok ? sha256Hex(content.value) : "missing";
};

const due = (runtime: Pick<Runtime, "readText" | "now">, root: AbsolutePath, item: Assumption): boolean => {
  const trigger = item.trigger;
  if (trigger === undefined || item.status === "review" || item.status === "false") return false;
  if (trigger.kind === "date") return runtime.now().slice(0, 10) >= trigger.value;
  if (trigger.kind === "file")
    return trigger.hash !== undefined && fileHash(runtime, root, trigger.value) !== trigger.hash;
  return false;
};

export const refreshTriggers = (
  runtime: Pick<Runtime, "readText" | "writeText" | "mkdir" | "now">,
  paths: FmPaths,
): readonly Assumption[] => {
  const list = readAssumptions(runtime, paths);
  const marked = list.map((item): Assumption =>
    due(runtime, paths.root, item) ? { ...item, status: "review" } : item,
  );
  if (marked.some((item, index) => item.status !== list[index]?.status)) writeAssumptions(runtime, paths, marked);
  return marked;
};

export const nextAssumptionId = (list: readonly Assumption[]): string =>
  `a${String(Math.max(0, ...list.map((item) => Number.parseInt(item.id.slice(1), 10)).filter(Number.isFinite)) + 1)}`;

export const openHighImpact = (list: readonly Assumption[], ids: readonly string[]): readonly Assumption[] =>
  list.filter(
    (item) =>
      (ids.includes(item.id) || ids.includes(item.text)) &&
      item.impact === "high" &&
      (item.status === "unverified" || item.status === "review"),
  );
