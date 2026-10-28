import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { loadProjectConfig } from "../git/project-config.js";
import { projectLogDir } from "../history/look-back.js";
import type { FmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import { readLedger, type SpendLedger, type SpendMessage, writeLedger } from "./ledger.js";
import { type Price, priceOf, priceTable, type Usage, usdOf } from "./prices.js";

const KEEP_DAYS = 40;
const DAY_MS = 86_400_000;

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

interface Parsed {
  readonly id: string;
  readonly at: string;
  readonly model: string;
  readonly usage: Usage;
}

const assistantLine = (line: string): Parsed | undefined => {
  const parsed = parseJsonObject(line);
  if (!parsed.ok) return undefined;
  const { message, timestamp } = parsed.value;
  if (!isRecord(message) || typeof timestamp !== "string") return undefined;
  const { id, model, usage } = message;
  if (typeof id !== "string" || typeof model !== "string" || !isRecord(usage)) return undefined;
  return {
    id,
    at: timestamp,
    model,
    usage: {
      input: count(usage["input_tokens"]),
      output: count(usage["output_tokens"]),
      cacheWrite: count(usage["cache_creation_input_tokens"]),
      cacheRead: count(usage["cache_read_input_tokens"]),
    },
  };
};

const tokensOf = (usage: Usage): number => usage.input + usage.output + usage.cacheWrite + usage.cacheRead;

const completeLines = (text: string): readonly string[] => {
  const end = text.lastIndexOf("\n");
  return end === -1 ? [] : text.slice(0, end).split("\n");
};

const taskFor = (
  at: string,
  active: string | undefined,
  starts: Readonly<Record<string, string>>,
): string | undefined => {
  if (active === undefined) return undefined;
  const since = starts[active];
  return since !== undefined && at >= since ? active : undefined;
};

export interface IngestInput {
  readonly runtime: Runtime;
  readonly paths: FmPaths;
  readonly env: Env;
}

const merge = (messages: Record<string, SpendMessage>, item: Parsed, price: Price, task: string | undefined): void => {
  const tokens = tokensOf(item.usage);
  const before = messages[item.id];
  if (before !== undefined && before.tokens >= tokens) return;
  const keep = before?.task ?? task;
  messages[item.id] = {
    at: item.at,
    model: item.model,
    usd: usdOf(price, item.usage),
    tokens,
    ...(keep === undefined ? {} : { task: keep }),
  };
};

export const ingest = ({ runtime, paths, env }: IngestInput): SpendLedger => {
  const ledger = readLedger(runtime, paths);
  const active = readState(runtime, paths).active;
  const now = runtime.now();
  const taskStarts =
    active === undefined || ledger.taskStarts[active] !== undefined
      ? ledger.taskStarts
      : { ...ledger.taskStarts, [active]: now };
  const table = priceTable(loadProjectConfig(runtime, paths.root));
  const dir = toAbsolutePath(projectLogDir(runtime, paths.root, env));
  const files = runtime.walkFiles(dir);
  const cursors: Record<string, number> = { ...ledger.cursors };
  const messages: Record<string, SpendMessage> = { ...ledger.messages };
  for (const file of (files.ok ? files.value : []).filter((name) => name.endsWith(".jsonl"))) {
    const text = runtime.readText(toAbsolutePath(join(dir, file)));
    const lines = text.ok ? completeLines(text.value) : [];
    for (const line of lines.slice(cursors[file] ?? 0)) {
      const item = assistantLine(line);
      if (item !== undefined) merge(messages, item, priceOf(table, item.model), taskFor(item.at, active, taskStarts));
    }
    cursors[file] = lines.length;
  }
  const oldest = new Date(Date.parse(now) - KEEP_DAYS * DAY_MS).toISOString();
  const kept = Object.fromEntries(Object.entries(messages).filter(([, message]) => message.at >= oldest));
  const next = { cursors, messages: kept, taskStarts };
  writeLedger(runtime, paths, next);
  return next;
};
