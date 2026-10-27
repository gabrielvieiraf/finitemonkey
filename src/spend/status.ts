import { nowMs } from "../core/clock.js";
import type { Env } from "../core/context.js";
import type { Runtime } from "../core/runtime.js";
import { loadProjectConfig } from "../git/project-config.js";
import { activeGrant } from "../guards/release/grants.js";
import type { FmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import { type Level, limitsOf, type ScopeSpend, spendByScope, worst } from "./budget.js";
import { ingest } from "./ingest.js";
import { readLedger } from "./ledger.js";

export const BUDGET_GUARD = "budget";

export interface BudgetStatus {
  readonly configured: boolean;
  readonly spends: readonly ScopeSpend[];
  readonly level: Level;
  readonly released: boolean;
  readonly estimate: true;
}

export interface StatusOptions {
  readonly runtime: Runtime;
  readonly paths: FmPaths;
  readonly env: Env;
  readonly sessionId: string | undefined;
  readonly refresh: boolean;
}

export const budgetStatus = ({ runtime, paths, env, sessionId, refresh }: StatusOptions): BudgetStatus => {
  const limits = limitsOf(loadProjectConfig(runtime, paths.root));
  const configured = Object.values(limits).some((limit) => limit !== undefined);
  const ledger = refresh && configured ? ingest({ runtime, paths, env }) : readLedger(runtime, paths);
  const spends = spendByScope(ledger, limits, runtime.now(), readState(runtime, paths).active);
  const released = activeGrant(runtime, paths, BUDGET_GUARD, nowMs(runtime), sessionId) !== undefined;
  return { configured, spends, level: worst(spends), released, estimate: true };
};

export const budgetConfigured = (runtime: Runtime, paths: FmPaths): boolean =>
  Object.values(limitsOf(loadProjectConfig(runtime, paths.root))).some((limit) => limit !== undefined);

export const blocksNewTask = (status: BudgetStatus): boolean => status.level === "over" && !status.released;
