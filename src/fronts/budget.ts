import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { DATA_DIR } from "../core/data-dir.js";
import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FrontsState } from "./state.js";

export const FRONTS_BUDGET_FEATURE = "fronts-budget";

export interface WaveSpend {
  readonly minutes: number;
  readonly usd: number;
}

export interface BudgetHit {
  readonly unit: "minutes" | "usd";
  readonly used: number;
  readonly limit: number;
}

const waveStart = (state: FrontsState): number | undefined => {
  const starts = state.fronts.flatMap((front) => {
    const at = front.startedAt === null ? Number.NaN : Date.parse(front.startedAt);
    return Number.isFinite(at) ? [at] : [];
  });
  return starts.length === 0 ? undefined : Math.min(...starts);
};

const loggedUsd = (runtime: Runtime, root: AbsolutePath, since: number): number => {
  const text = runtime.readText(toAbsolutePath(join(root, DATA_DIR, "cost.jsonl")));
  if (!text.ok) return 0;
  return text.value.split("\n").reduce((total, line) => {
    const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
    if (parsed?.ok !== true) return total;
    const { at, usd } = parsed.value;
    const when = typeof at === "string" ? Date.parse(at) : Number.NaN;
    return typeof usd === "number" && Number.isFinite(usd) && when >= since ? total + usd : total;
  }, 0);
};

export const waveSpend = (runtime: Runtime, root: AbsolutePath, state: FrontsState): WaveSpend => {
  const start = waveStart(state);
  if (start === undefined) return { minutes: 0, usd: 0 };
  const reported = state.fronts.reduce((total, front) => total + front.costUsd, 0);
  return {
    minutes: Math.max(0, (Date.parse(runtime.now()) - start) / 60_000),
    usd: Math.max(reported, loggedUsd(runtime, root, start)),
  };
};

const round = (value: number): number => Math.round(value * 100) / 100;

export const budgetHit = (state: FrontsState, spend: WaveSpend): BudgetHit | undefined => {
  if (state.budgetMinutes !== null && spend.minutes >= state.budgetMinutes) {
    return { unit: "minutes", used: Math.floor(spend.minutes), limit: state.budgetMinutes };
  }
  if (state.budgetUsd !== null && spend.usd >= state.budgetUsd) {
    return { unit: "usd", used: round(spend.usd), limit: state.budgetUsd };
  }
  return undefined;
};
