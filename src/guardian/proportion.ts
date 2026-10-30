import { isRecord } from "../core/parsed.js";
import { parseYaml } from "../core/yaml/parse.js";
import type { Translate } from "../i18n/translate.js";
import { type CompanyContext, raisingBudget } from "./context.js";
import { GOALS_FILE } from "./goals.js";
import { LEVEL_OF, type RealityReport } from "./report.js";
import type { SolutionWeight } from "./weight.js";

export const VERDICTS = ["silent", "report"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const SILENT_REASONS = ["within_budget", "demonstrated", "decided", "nothing_new"] as const;
export type SilentReason = (typeof SILENT_REASONS)[number];

export interface ProblemWeight {
  readonly scale: readonly string[];
  readonly deadline?: string;
}

export interface Proportion {
  readonly verdict: Verdict;
  readonly reason?: SilentReason;
  readonly budget: number;
  readonly tokens: number;
  readonly problem: ProblemWeight;
  readonly askScale: boolean;
}

const numbersIn = (value: unknown): readonly string[] => {
  if (typeof value === "number") return [String(value)];
  if (typeof value === "string") return /\d/.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(numbersIn);
  if (isRecord(value))
    return Object.entries(value).flatMap(([key, item]) => numbersIn(item).map((text) => `${key}: ${text}`));
  return [];
};

export const problemWeight = (contractText: string): ProblemWeight => {
  const parsed = parseYaml(contractText);
  const tree = parsed.ok && isRecord(parsed.value) ? parsed.value : {};
  const deadline = tree["deadline"];
  return {
    scale: numbersIn(tree["scale"]),
    ...(typeof deadline === "string" && deadline !== "" ? { deadline } : {}),
  };
};

export const weigh = (
  weight: SolutionWeight,
  context: CompanyContext,
  problem: ProblemWeight,
  decided: (concept: string) => boolean,
): Proportion => {
  const budget = raisingBudget(context);
  const base = { budget, tokens: weight.tokens, problem, askScale: false };
  if (weight.concepts.length === 0 && weight.tokens === 0) return { ...base, verdict: "silent", reason: "nothing_new" };
  if (weight.tokens <= budget && weight.reversibility === "A")
    return { ...base, verdict: "silent", reason: "within_budget" };
  if (weight.beyond.length === 0) return { ...base, verdict: "silent", reason: "demonstrated" };
  if (weight.beyond.every(decided)) return { ...base, verdict: "silent", reason: "decided" };
  return { ...base, verdict: "report", askScale: problem.scale.length === 0 };
};

export const proportionReport = (
  t: Translate,
  weight: SolutionWeight,
  context: CompanyContext,
  proportion: Proportion,
  request: string,
): RealityReport => {
  const stage = context.stage?.value ?? "-";
  return {
    trigger: "proportionality",
    level: LEVEL_OF.proportionality,
    perceivedGoal: context.milestone?.value ?? request,
    request,
    finding: t("guardian.trigger.proportionality.finding", {
      tokens: proportion.tokens,
      budget: proportion.budget,
      stage,
    }),
    evidence: [...weight.evidence, `${GOALS_FILE}: context.stage ${stage} (${context.stage?.origin ?? "missing"})`],
    assumptions: proportion.askScale ? [t("guardian.weigh.scale_unknown")] : proportion.problem.scale,
    consequences: t("guardian.trigger.proportionality.consequences"),
    alternatives: [
      t("guardian.weigh.row.requested", {
        files: weight.newFiles,
        deps: weight.newDependencies,
        operate: weight.operate.join(", ") || "-",
        undo: weight.reversibility,
        beyond: weight.beyond.join(", ") || "-",
      }),
      t("guardian.weigh.row.simplest"),
      t("guardian.weigh.row.nothing"),
    ],
    recommendation: t("guardian.trigger.proportionality.recommendation"),
    certainty: "medium",
    nextStep: proportion.askScale ? t("guardian.weigh.ask_scale") : t("guardian.trigger.proportionality.next"),
    paths: [],
    key: weight.concepts.join(","),
  };
};
