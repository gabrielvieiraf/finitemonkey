import { isRecord, type JsonObject } from "../src/core/parsed.js";
import { ARMS } from "./review-bench-lib.js";

export interface ArmScore {
  readonly arm: string;
  readonly reviews: number;
  readonly skipped: number;
  readonly errors: number;
  readonly candidates: number;
  readonly golden: number;
  readonly tp: number;
  readonly fp: number;
  readonly fn: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export const scoreArms = (evaluations: JsonObject): readonly ArmScore[] =>
  ARMS.map((arm) => {
    const results = Object.values(evaluations).flatMap((tools) =>
      isRecord(tools) && isRecord(tools[arm]) ? [tools[arm]] : [],
    );
    const judged = results.filter((result) => result["skipped"] !== true);
    const sum = (key: string): number => judged.reduce((total, result) => total + count(result[key]), 0);
    const tp = sum("tp");
    const fp = sum("fp");
    const fn = sum("fn");
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    return {
      arm,
      reviews: judged.length,
      skipped: results.length - judged.length,
      errors: sum("errors_count"),
      candidates: sum("total_candidates"),
      golden: sum("total_golden"),
      tp,
      fp,
      fn,
      precision,
      recall,
      f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
    };
  });

export const judgeModelDir = (model: string): string => model.trim().replaceAll("/", "_");

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

const row = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;

export const scoreTable = (scores: readonly ArmScore[]): string =>
  [
    row(["Arm", "Reviews", "Candidates", "Golden", "TP", "FP", "FN", "Precision", "Recall", "F1"]),
    `|${"---|".repeat(10)}`,
    ...scores.map((score) =>
      row([
        `\`${score.arm}\``,
        String(score.reviews),
        String(score.candidates),
        String(score.golden),
        String(score.tp),
        String(score.fp),
        String(score.fn),
        pct(score.precision),
        pct(score.recall),
        pct(score.f1),
      ]),
    ),
  ].join("\n");
