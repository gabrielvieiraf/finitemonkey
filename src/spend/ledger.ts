import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";

export interface SpendMessage {
  readonly at: string;
  readonly model: string;
  readonly usd: number;
  readonly tokens: number;
  readonly task?: string;
}

export interface SpendLedger {
  readonly cursors: Readonly<Record<string, number>>;
  readonly messages: Readonly<Record<string, SpendMessage>>;
  readonly taskStarts: Readonly<Record<string, string>>;
}

export const SPEND_FILE = "spend.json";

export const spendPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, SPEND_FILE));

const numbers = (value: unknown): Readonly<Record<string, number>> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
      )
    : {};

const texts = (value: unknown): Readonly<Record<string, string>> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : {};

const messageOf = (value: unknown): SpendMessage | undefined => {
  if (!isRecord(value)) return undefined;
  const { at, model, usd, tokens, task } = value;
  if (typeof at !== "string" || typeof model !== "string" || typeof usd !== "number" || typeof tokens !== "number")
    return undefined;
  return { at, model, usd, tokens, ...(typeof task === "string" ? { task } : {}) };
};

export const readLedger = (runtime: Pick<Runtime, "readText">, paths: FmPaths): SpendLedger => {
  const raw: JsonObject = readJsonFile(runtime, spendPath(paths)) ?? {};
  const messages = isRecord(raw["messages"]) ? raw["messages"] : {};
  return {
    cursors: numbers(raw["cursors"]),
    taskStarts: texts(raw["taskStarts"]),
    messages: Object.fromEntries(
      Object.entries(messages).flatMap(([id, value]) => {
        const message = messageOf(value);
        return message === undefined ? [] : [[id, message] as const];
      }),
    ),
  };
};

export const writeLedger = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, ledger: SpendLedger): boolean =>
  writeJsonFile(runtime, spendPath(paths), { ...ledger }).ok;
