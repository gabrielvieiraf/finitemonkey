import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import type { SpendLedger } from "./ledger.js";

export const RECONCILE_TOOL = "ccusage";
export const RECONCILE_FILE = "spend-reconcile.jsonl";
const TIMEOUT_MS = 60_000;

export interface DayDiff {
  readonly date: string;
  readonly ours: number;
  readonly theirs: number;
  readonly diff: number;
}

export interface Reconciliation {
  readonly at: string;
  readonly tool: string;
  readonly days: readonly DayDiff[];
}

export const reconcilePath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, RECONCILE_FILE));

const theirDays = (stdout: string): ReadonlyMap<string, number> => {
  const parsed = parseJsonObject(stdout);
  const daily = parsed.ok ? parsed.value["daily"] : undefined;
  if (!Array.isArray(daily)) return new Map();
  return new Map(
    daily.flatMap((day) => {
      if (!isRecord(day)) return [];
      const { date, totalCost } = day;
      return typeof date === "string" && typeof totalCost === "number" ? [[date, totalCost] as const] : [];
    }),
  );
};

const ourDays = (ledger: SpendLedger): ReadonlyMap<string, number> => {
  const days = new Map<string, number>();
  for (const message of Object.values(ledger.messages)) {
    const date = message.at.slice(0, 10);
    days.set(date, (days.get(date) ?? 0) + message.usd);
  }
  return days;
};

const round = (value: number): number => Math.round(value * 10_000) / 10_000;

export const reconcile = (runtime: Runtime, paths: FmPaths, ledger: SpendLedger): Reconciliation | undefined => {
  if (!runtime.probe(RECONCILE_TOOL, ["--version"], 3_000).found) return undefined;
  const run = runtime.exec({
    command: RECONCILE_TOOL,
    args: ["daily", "--json", "--offline"],
    cwd: paths.root,
    timeoutMs: TIMEOUT_MS,
  });
  if (!run.found || run.exitCode !== 0) return undefined;
  const theirs = theirDays(run.stdout);
  const ours = ourDays(ledger);
  const dates = [...new Set([...theirs.keys(), ...ours.keys()])].sort();
  const days = dates.map((date) => {
    const mine = round(ours.get(date) ?? 0);
    const other = round(theirs.get(date) ?? 0);
    return { date, ours: mine, theirs: other, diff: round(mine - other) };
  });
  const record: Reconciliation = { at: runtime.now(), tool: RECONCILE_TOOL, days };
  runtime.appendText(reconcilePath(paths), `${JSON.stringify(record)}\n`);
  return record;
};
