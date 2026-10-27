import { configAt, type ConfigTree } from "../git/project-config.js";
import type { SpendLedger } from "./ledger.js";

export const SCOPES = ["task", "day", "month"] as const;

export type Scope = (typeof SCOPES)[number];

export type Level = "ok" | "warn" | "over";

export interface ScopeSpend {
  readonly scope: Scope;
  readonly spent: number;
  readonly limit: number | undefined;
  readonly level: Level;
}

export const WARN_AT = 0.8;

export const limitsOf = (config: ConfigTree): Readonly<Record<Scope, number | undefined>> => {
  const read = (scope: Scope): number | undefined => {
    const value = configAt(config, "budget", `${scope}_usd`);
    const parsed = typeof value === "string" ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };
  return { task: read("task"), day: read("day"), month: read("month") };
};

const levelOf = (spent: number, limit: number | undefined): Level => {
  if (limit === undefined) return "ok";
  if (spent >= limit) return "over";
  return spent >= limit * WARN_AT ? "warn" : "ok";
};

export const spendByScope = (
  ledger: SpendLedger,
  limits: Readonly<Record<Scope, number | undefined>>,
  now: string,
  task: string | undefined,
): readonly ScopeSpend[] => {
  const messages = Object.values(ledger.messages);
  const sum = (keep: (at: string, owner: string | undefined) => boolean): number =>
    messages.filter((message) => keep(message.at, message.task)).reduce((total, message) => total + message.usd, 0);
  const spent: Readonly<Record<Scope, number>> = {
    task: task === undefined ? 0 : sum((_at, owner) => owner === task),
    day: sum((at) => at.slice(0, 10) === now.slice(0, 10)),
    month: sum((at) => at.slice(0, 7) === now.slice(0, 7)),
  };
  return SCOPES.map((scope) => ({
    scope,
    spent: spent[scope],
    limit: limits[scope],
    level: levelOf(spent[scope], limits[scope]),
  }));
};

export const worst = (spends: readonly ScopeSpend[]): Level =>
  spends.some((item) => item.level === "over") ? "over" : spends.some((item) => item.level === "warn") ? "warn" : "ok";

export const money = (value: number): string => `$${value.toFixed(2)}`;
