import { accept, isRecord, type JsonObject, type Parsed, reject } from "../src/core/parsed.js";
import type { CorpusCase, Origin } from "./evidence-corpus.js";

export const EVIDENCE_SCHEMA = "finitemonkey/evidence@1";

export interface CaseResult {
  readonly item: CorpusCase;
  readonly blocked: boolean;
  readonly ms: number;
}

export interface GuardEvidence {
  readonly guard: string;
  readonly n: number;
  readonly positives: number;
  readonly negatives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly fpr: number;
  readonly fnr: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly byOrigin: Readonly<Record<Origin, number>>;
  readonly wrong: readonly string[];
}

export interface ArmOverhead {
  readonly arm: string;
  readonly runs: number;
  readonly tokensMedian: number | null;
  readonly wallMsMedian: number | null;
  readonly costUsdMedian: number | null;
  readonly falseDoneRate: number | null;
}

export interface Evidence {
  readonly schema: typeof EVIDENCE_SCHEMA;
  readonly version: string;
  readonly budget: GuardBudget;
  readonly guards: readonly GuardEvidence[];
  readonly contextBytes: Readonly<Record<string, number>>;
  readonly arms: readonly ArmOverhead[];
  readonly review: ReviewEvidence | null;
}

export interface ReviewArmScore {
  readonly arm: string;
  readonly reviews: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

export interface ReviewEvidence {
  readonly benchmark: string;
  readonly commit: string;
  readonly judgeModel: string;
  readonly arms: readonly ReviewArmScore[];
}

export interface GuardBudget {
  readonly fprWarn: number;
  readonly fprFail: number;
  readonly minPositives: number;
  readonly minNegatives: number;
}

export interface EvidenceBudgets {
  readonly defaults: GuardBudget;
  readonly guards: Readonly<Record<string, Partial<GuardBudget>>>;
}

export type Verdict = "ok" | "warn" | "fail";

export interface GuardVerdict {
  readonly guard: string;
  readonly verdict: Verdict;
  readonly reasons: readonly string[];
}

export const percentile = (samples: readonly number[], fraction: number): number => {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
};

const ratio = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);

const round = (value: number, digits: number): number => Number(value.toFixed(digits));

export const guardEvidence = (guard: string, results: readonly CaseResult[]): GuardEvidence => {
  const positives = results.filter((result) => result.item.expect === "block");
  const negatives = results.filter((result) => result.item.expect === "allow");
  const falsePositives = negatives.filter((result) => result.blocked);
  const falseNegatives = positives.filter((result) => !result.blocked);
  const times = results.map((result) => result.ms);
  return {
    guard,
    n: results.length,
    positives: positives.length,
    negatives: negatives.length,
    falsePositives: falsePositives.length,
    falseNegatives: falseNegatives.length,
    fpr: round(ratio(falsePositives.length, negatives.length), 4),
    fnr: round(ratio(falseNegatives.length, positives.length), 4),
    p50Ms: round(percentile(times, 0.5), 2),
    p95Ms: round(percentile(times, 0.95), 2),
    byOrigin: {
      synthetic: results.filter((result) => result.item.origin === "synthetic").length,
      session: results.filter((result) => result.item.origin === "session").length,
    },
    wrong: [...falsePositives, ...falseNegatives].map((result) => result.item.id),
  };
};

const median = (values: readonly number[]): number | null => (values.length === 0 ? null : percentile(values, 0.5));

const numbers = (records: readonly JsonObject[], read: (record: JsonObject) => unknown): readonly number[] =>
  records.flatMap((record) => {
    const value = read(record);
    return typeof value === "number" && Number.isFinite(value) ? [value] : [];
  });

export const armOverhead = (records: readonly JsonObject[]): readonly ArmOverhead[] => {
  const arms = [...new Set(records.flatMap((record) => (typeof record["arm"] === "string" ? [record["arm"]] : [])))];
  return arms.sort().map((arm) => {
    const own = records.filter((record) => record["arm"] === arm);
    const claimed = own.filter((record) => typeof record["falseDone"] === "boolean");
    return {
      arm,
      runs: own.length,
      tokensMedian: median(
        numbers(own, (record) =>
          typeof record["inputTokens"] === "number" && typeof record["outputTokens"] === "number"
            ? record["inputTokens"] + record["outputTokens"]
            : undefined,
        ),
      ),
      wallMsMedian: median(numbers(own, (record) => record["durationMs"])),
      costUsdMedian: median(numbers(own, (record) => record["costUsd"])),
      falseDoneRate:
        claimed.length === 0
          ? null
          : round(ratio(claimed.filter((record) => record["falseDone"] === true).length, claimed.length), 4),
    };
  });
};

export const DEFAULT_GUARD_BUDGET: GuardBudget = { fprWarn: 0.05, fprFail: 0.15, minPositives: 50, minNegatives: 50 };

const budgetFields = (raw: unknown): Partial<GuardBudget> | undefined => {
  if (!isRecord(raw)) return undefined;
  const out: Partial<Record<keyof GuardBudget, number>> = {};
  for (const key of ["fprWarn", "fprFail", "minPositives", "minNegatives"] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || value < 0) return undefined;
    out[key] = value;
  }
  return out;
};

export const parseEvidenceBudgets = (raw: unknown): Parsed<EvidenceBudgets> => {
  if (raw === undefined) return accept({ defaults: DEFAULT_GUARD_BUDGET, guards: {} });
  if (!isRecord(raw)) return reject("budgets.json evidence must be an object");
  const defaults = budgetFields(raw);
  if (defaults === undefined) return reject("budgets.json evidence values must be numbers of zero or more");
  const guardsRaw = raw["guards"] ?? {};
  if (!isRecord(guardsRaw)) return reject("budgets.json evidence.guards must be an object");
  const guards: Record<string, Partial<GuardBudget>> = {};
  for (const [guard, value] of Object.entries(guardsRaw)) {
    const fields = budgetFields(value);
    if (fields === undefined) return reject(`budgets.json evidence.guards.${guard} values must be numbers`);
    guards[guard] = fields;
  }
  return accept({ defaults: { ...DEFAULT_GUARD_BUDGET, ...defaults }, guards });
};

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

export const judge = (evidence: GuardEvidence, budgets: EvidenceBudgets): GuardVerdict => {
  const budget = { ...budgets.defaults, ...budgets.guards[evidence.guard] };
  const failures: string[] = [];
  if (evidence.positives < budget.minPositives) {
    failures.push(`${String(evidence.positives)} positives, needs ${String(budget.minPositives)}`);
  }
  if (evidence.negatives < budget.minNegatives) {
    failures.push(`${String(evidence.negatives)} negatives, needs ${String(budget.minNegatives)}`);
  }
  if (evidence.fpr > budget.fprFail) {
    failures.push(`false positive rate ${percent(evidence.fpr)} over ${percent(budget.fprFail)}`);
  }
  if (failures.length > 0) return { guard: evidence.guard, verdict: "fail", reasons: failures };
  if (evidence.fpr > budget.fprWarn) {
    return {
      guard: evidence.guard,
      verdict: "warn",
      reasons: [`false positive rate ${percent(evidence.fpr)} over the ${percent(budget.fprWarn)} alert budget`],
    };
  }
  return { guard: evidence.guard, verdict: "ok", reasons: [] };
};

const isNumberOrNull = (value: unknown): value is number | null => value === null || typeof value === "number";

const guardOf = (raw: unknown): GuardEvidence | undefined => {
  if (!isRecord(raw)) return undefined;
  const { guard, n, positives, negatives, falsePositives, falseNegatives, fpr, fnr, p50Ms, p95Ms } = raw;
  const counts = [n, positives, negatives, falsePositives, falseNegatives, fpr, fnr, p50Ms, p95Ms];
  if (typeof guard !== "string" || !counts.every((value) => typeof value === "number")) return undefined;
  const origin = isRecord(raw["byOrigin"]) ? raw["byOrigin"] : {};
  const wrong = Array.isArray(raw["wrong"]) ? raw["wrong"].filter((item) => typeof item === "string") : [];
  const num = (value: unknown): number => (typeof value === "number" ? value : 0);
  return {
    guard,
    n: num(n),
    positives: num(positives),
    negatives: num(negatives),
    falsePositives: num(falsePositives),
    falseNegatives: num(falseNegatives),
    fpr: num(fpr),
    fnr: num(fnr),
    p50Ms: num(p50Ms),
    p95Ms: num(p95Ms),
    byOrigin: { synthetic: num(origin["synthetic"]), session: num(origin["session"]) },
    wrong,
  };
};

const reviewArmOf = (raw: unknown): ReviewArmScore | undefined => {
  if (!isRecord(raw)) return undefined;
  const { arm, reviews, precision, recall, f1 } = raw;
  return typeof arm === "string" &&
    typeof reviews === "number" &&
    typeof precision === "number" &&
    typeof recall === "number" &&
    typeof f1 === "number"
    ? { arm, reviews, precision, recall, f1 }
    : undefined;
};

export const parseReviewEvidence = (raw: unknown): ReviewEvidence | null => {
  if (!isRecord(raw)) return null;
  const { benchmark, commit, judgeModel } = raw;
  const arms = Array.isArray(raw["arms"]) ? raw["arms"].map(reviewArmOf) : [];
  if (typeof benchmark !== "string" || typeof commit !== "string" || typeof judgeModel !== "string") return null;
  if (arms.length === 0 || arms.some((arm) => arm === undefined)) return null;
  return { benchmark, commit, judgeModel, arms: arms.flatMap((arm) => (arm === undefined ? [] : [arm])) };
};

const armOf = (raw: unknown): ArmOverhead | undefined => {
  if (!isRecord(raw)) return undefined;
  const { arm, runs, tokensMedian, wallMsMedian, costUsdMedian, falseDoneRate } = raw;
  if (typeof arm !== "string" || typeof runs !== "number") return undefined;
  if (![tokensMedian, wallMsMedian, costUsdMedian, falseDoneRate].every(isNumberOrNull)) return undefined;
  return {
    arm,
    runs,
    tokensMedian: typeof tokensMedian === "number" ? tokensMedian : null,
    wallMsMedian: typeof wallMsMedian === "number" ? wallMsMedian : null,
    costUsdMedian: typeof costUsdMedian === "number" ? costUsdMedian : null,
    falseDoneRate: typeof falseDoneRate === "number" ? falseDoneRate : null,
  };
};

export const parseEvidence = (raw: JsonObject): Parsed<Evidence> => {
  if (raw["schema"] !== EVIDENCE_SCHEMA) return reject(`evidence schema must be ${EVIDENCE_SCHEMA}`);
  const version = raw["version"];
  if (typeof version !== "string") return reject("evidence needs a version");
  const guards = Array.isArray(raw["guards"]) ? raw["guards"].map(guardOf) : [];
  const arms = Array.isArray(raw["arms"]) ? raw["arms"].map(armOf) : [];
  const context = isRecord(raw["contextBytes"]) ? raw["contextBytes"] : {};
  const budget = { ...DEFAULT_GUARD_BUDGET, ...budgetFields(raw["budget"]) };
  if (guards.some((item) => item === undefined) || arms.some((item) => item === undefined)) {
    return reject("evidence guards or arms are malformed");
  }
  return accept({
    schema: EVIDENCE_SCHEMA,
    version,
    budget,
    guards: guards.flatMap((item) => (item === undefined ? [] : [item])),
    contextBytes: Object.fromEntries(
      Object.entries(context).flatMap(([name, value]) => (typeof value === "number" ? [[name, value]] : [])),
    ),
    arms: arms.flatMap((item) => (item === undefined ? [] : [item])),
    review: parseReviewEvidence(raw["review"]),
  });
};
