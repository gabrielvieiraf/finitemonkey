import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { readLedger } from "../evidence/ledger.js";
import { loadProjectConfig } from "../git/project-config.js";
import { experimentArm } from "../policy/experiment.js";
import { loadPolicy } from "../policy/policy.js";
import { priceOf, priceTable, usdOf } from "../spend/prices.js";
import type { FmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";

export const COST_FILE = "cost.jsonl";
export const MOD_COST_SCHEMA = "finitemonkey/mod-cost@1";
export const IMPLICIT_TASK = "implicit";

export interface Step {
  readonly model: string;
  readonly agent: string | null;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

export interface CostLine extends Step {
  readonly at: string;
  readonly task: string;
  readonly arms: readonly string[];
  readonly usd: number;
}

export interface ArmCost {
  readonly arm: string;
  readonly usd: number;
  readonly requests: number;
}

export interface CostSummary {
  readonly schema: typeof MOD_COST_SCHEMA;
  readonly task: string;
  readonly usd: number;
  readonly requests: number;
  readonly attempts: number;
  readonly perAttempt: number | null;
  readonly byArm: readonly ArmCost[];
}

export const costFile = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, COST_FILE));

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

const stepOf = (value: unknown): Step | undefined => {
  if (!isRecord(value) || typeof value["model"] !== "string") return undefined;
  const agent = value["agent"];
  return {
    model: value["model"],
    agent: typeof agent === "string" ? agent : null,
    input: count(value["input"]),
    output: count(value["output"]),
    cacheRead: count(value["cacheRead"]),
    cacheWrite: count(value["cacheWrite"]),
  };
};

export const parseSteps = (text: string): readonly Step[] => {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map(stepOf).filter((step): step is Step => step !== undefined) : [];
  } catch {
    return [];
  }
};

const taskOf = (runtime: Pick<Runtime, "readText">, paths: FmPaths): string =>
  readState(runtime, paths).active ?? IMPLICIT_TASK;

const armsOf = (runtime: Runtime, paths: FmPaths): readonly string[] => {
  const policy = loadPolicy(runtime, paths.root);
  return Object.keys(policy.experiments).flatMap((feature) => {
    const arm = experimentArm(runtime, paths, policy, feature);
    return arm === undefined ? [] : [`${feature}=${arm}`];
  });
};

export const recordSteps = (runtime: Runtime, paths: FmPaths, steps: readonly Step[]): number => {
  const table = priceTable(loadProjectConfig(runtime, paths.root));
  const task = taskOf(runtime, paths);
  const arms = armsOf(runtime, paths);
  const at = runtime.now();
  const lines = steps.map((step) => ({ ...step, at, task, arms, usd: usdOf(priceOf(table, step.model), step) }));
  if (lines.length > 0) runtime.appendText(costFile(paths), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  return lines.length;
};

const lineOf = (text: string): CostLine | undefined => {
  const parsed = parseJsonObject(text);
  if (!parsed.ok) return undefined;
  const step = stepOf(parsed.value);
  const { at, task, arms, usd } = parsed.value;
  if (step === undefined || typeof at !== "string" || typeof task !== "string") return undefined;
  const list = Array.isArray(arms) ? arms.filter((arm): arm is string => typeof arm === "string") : [];
  return { ...step, at, task, arms: list, usd: count(usd) };
};

export const readCost = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly CostLine[] => {
  const text = runtime.readText(costFile(paths));
  if (!text.ok) return [];
  return text.value
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(lineOf)
    .filter((line): line is CostLine => line !== undefined);
};

const sum = (lines: readonly CostLine[]): number => lines.reduce((total, line) => total + line.usd, 0);

const attemptsOf = (runtime: Runtime, paths: FmPaths, task: string): number =>
  new Set(readLedger(runtime, paths.evidence(task)).map((entry) => entry.treeHash)).size;

export const costOf = (runtime: Runtime, paths: FmPaths): CostSummary => {
  const task = taskOf(runtime, paths);
  const lines = readCost(runtime, paths).filter((line) => line.task === task);
  const attempts = attemptsOf(runtime, paths, task);
  const usd = sum(lines);
  const arms = [...new Set(lines.flatMap((line) => line.arms))].sort();
  return {
    schema: MOD_COST_SCHEMA,
    task,
    usd,
    requests: lines.length,
    attempts,
    perAttempt: attempts === 0 ? null : usd / attempts,
    byArm: arms.map((arm) => {
      const own = lines.filter((line) => line.arms.includes(arm));
      return { arm, usd: sum(own), requests: own.length };
    }),
  };
};
