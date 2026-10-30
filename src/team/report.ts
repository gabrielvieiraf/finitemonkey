import type { Evidence } from "../evidence/types.js";
import { GATE_CHECK } from "../evidence/types.js";
import { type CommitFact, isRework, REVERT, REWORK_DAYS } from "./history.js";

export const TEAM_SCHEMA = "finitemonkey/team-report@1";
export const DEFAULT_K = 3;
export const METRICS = ["falseDone", "firstTry", "rework", "reverts", "spendPerTask"] as const;
export const NOT_MEASURED = ["reviewTime", "securityFindings"] as const;

export type Metric = (typeof METRICS)[number];

export interface TaskLedger {
  readonly task: string;
  readonly entries: readonly Evidence[];
}

export interface TaskSpend {
  readonly task: string;
  readonly at: string;
  readonly usd: number;
}

export interface Interval {
  readonly low: number;
  readonly high: number;
}

export interface Bucket {
  readonly period: string;
  readonly suppressed: boolean;
  readonly commits: number;
  readonly tasks: number;
  readonly falseDone: number;
  readonly firstTry: number;
  readonly firstTryRate: Interval | null;
  readonly rework: number;
  readonly reverts: number;
  readonly spendTasks: number;
  readonly spendMedianUsd: number | null;
}

export interface MethodLine {
  readonly metric: Metric | (typeof NOT_MEASURED)[number];
  readonly definition: string;
  readonly source: string;
}

export interface TeamReport {
  readonly schema: typeof TEAM_SCHEMA;
  readonly k: number;
  readonly buckets: readonly Bucket[];
  readonly method: readonly MethodLine[];
}

export const METHOD: readonly MethodLine[] = [
  {
    metric: "falseDone",
    definition: "gate runs at a done claim that did not pass",
    source: ".finitemonkey/evidence/<task>.jsonl, *gate* entries",
  },
  {
    metric: "firstTry",
    definition: "tasks whose first gate run passed, with a 95% Wilson interval over the tasks of the period",
    source: ".finitemonkey/evidence/<task>.jsonl, first *gate* entry",
  },
  {
    metric: "rework",
    definition: `fix commits touching a file that a non-fix commit changed in the previous ${String(REWORK_DAYS)} days`,
    source: "git log --name-only",
  },
  { metric: "reverts", definition: 'commits whose subject starts with Revert " or revert:', source: "git log" },
  {
    metric: "spendPerTask",
    definition: "median dollars per task, from the token counts the API reported",
    source: ".finitemonkey/cost.jsonl",
  },
  {
    metric: "reviewTime",
    definition: "not measured: it needs the forge API, which this report does not call",
    source: "none",
  },
  { metric: "securityFindings", definition: "not measured in this version", source: "none" },
];

const Z = 1.96;

export const wilson = (hits: number, total: number): Interval | null => {
  if (total === 0) return null;
  const p = hits / total;
  const denominator = 1 + (Z * Z) / total;
  const center = p + (Z * Z) / (2 * total);
  const margin = Z * Math.sqrt((p * (1 - p)) / total + (Z * Z) / (4 * total * total));
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  return { low: round((center - margin) / denominator), high: round((center + margin) / denominator) };
};

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const periodOf = (at: string): string => at.slice(0, 7);

const gateRuns = (ledger: TaskLedger): readonly Evidence[] =>
  ledger.entries.filter((entry) => entry.check === GATE_CHECK);

const ledgerFacts = (ledgers: readonly TaskLedger[], period: string) => {
  const runs = ledgers.map(gateRuns).filter((items) => items.length > 0 && periodOf(items[0]?.at ?? "") === period);
  return {
    tasks: runs.length,
    falseDone: runs.reduce((total, items) => total + items.filter((entry) => entry.status !== "passed").length, 0),
    firstTry: runs.filter((items) => items[0]?.status === "passed").length,
  };
};

const spendFacts = (spend: readonly TaskSpend[], period: string) => {
  const perTask = new Map<string, number>();
  for (const item of spend)
    if (periodOf(item.at) === period) perTask.set(item.task, (perTask.get(item.task) ?? 0) + item.usd);
  const median_ = median([...perTask.values()]);
  return { spendTasks: perTask.size, spendMedianUsd: median_ === null ? null : Math.round(median_ * 100) / 100 };
};

const bucketOf = (
  period: string,
  commits: readonly CommitFact[],
  ledgers: readonly TaskLedger[],
  spend: readonly TaskSpend[],
  k: number,
): Bucket => {
  const inPeriod = commits.filter((commit) => periodOf(commit.at) === period);
  const facts = ledgerFacts(ledgers, period);
  const contributors = new Set(inPeriod.map((commit) => commit.author)).size;
  return {
    period,
    suppressed: contributors < k,
    commits: inPeriod.length,
    ...facts,
    firstTryRate: wilson(facts.firstTry, facts.tasks),
    rework: inPeriod.filter((commit) => isRework(commit, commits.slice(0, commits.indexOf(commit)))).length,
    reverts: inPeriod.filter((commit) => REVERT.test(commit.subject)).length,
    ...spendFacts(spend, period),
  };
};

const SUPPRESSED = {
  commits: 0,
  tasks: 0,
  falseDone: 0,
  firstTry: 0,
  firstTryRate: null,
  rework: 0,
  reverts: 0,
  spendTasks: 0,
  spendMedianUsd: null,
} as const;

export const teamReport = (
  commits: readonly CommitFact[],
  ledgers: readonly TaskLedger[],
  spend: readonly TaskSpend[],
  k: number = DEFAULT_K,
): TeamReport => {
  const periods = [...new Set(commits.map((commit) => periodOf(commit.at)))].sort();
  const buckets = periods.map((period) => {
    const bucket = bucketOf(period, commits, ledgers, spend, k);
    return bucket.suppressed ? { period, suppressed: true, ...SUPPRESSED } : bucket;
  });
  return { schema: TEAM_SCHEMA, k, buckets, method: METHOD };
};
