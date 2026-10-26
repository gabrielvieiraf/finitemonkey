import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { isFlagged, scoreProse } from "../src/prose/score.js";
import { ROOT } from "./support.js";

const CORPUS = join(ROOT, "test", "fixtures", "prose");
const LABELS = ["good", "bad"] as const;
const RECORD_SAMPLE = /commit|pr-body|issue|changelog/;

interface Sample {
  readonly label: (typeof LABELS)[number];
  readonly name: string;
  readonly flagged: boolean;
  readonly rules: readonly string[];
}

const samples: readonly Sample[] = LABELS.flatMap((label) =>
  readdirSync(join(CORPUS, label))
    .sort()
    .map((name) => {
      const context = RECORD_SAMPLE.test(name) ? "record" : "docs";
      const report = scoreProse(readFileSync(join(CORPUS, label, name), "utf8"), { context });
      return { label, name, flagged: isFlagged(report), rules: report.hits.map((hit) => hit.rule) };
    }),
);

const count = (predicate: (sample: Sample) => boolean): number => samples.filter(predicate).length;

describe("prose corpus labeled by hand", () => {
  const truePositive = count((sample) => sample.label === "bad" && sample.flagged);
  const falsePositive = count((sample) => sample.label === "good" && sample.flagged);
  const falseNegative = count((sample) => sample.label === "bad" && !sample.flagged);
  const precision = truePositive / Math.max(truePositive + falsePositive, 1);
  const recall = truePositive / Math.max(truePositive + falseNegative, 1);

  it("has good and bad samples in every language", () => {
    for (const label of LABELS) {
      for (const lang of ["en-", "pt-BR-", "es-"]) {
        assert.ok(
          samples.some((sample) => sample.label === label && sample.name.startsWith(lang)),
          `${label} ${lang}`,
        );
      }
    }
  });

  it("reaches precision and recall of 0.9 or more", (t) => {
    const hitsOnGood = new Map<string, number>();
    for (const rule of samples.filter((sample) => sample.label === "good").flatMap((sample) => sample.rules)) {
      hitsOnGood.set(rule, (hitsOnGood.get(rule) ?? 0) + 1);
    }
    t.diagnostic(`samples=${String(samples.length)} precision=${precision.toFixed(2)} recall=${recall.toFixed(2)}`);
    t.diagnostic(`single hits on good samples: ${JSON.stringify(Object.fromEntries(hitsOnGood))}`);
    assert.ok(precision >= 0.9, `precision ${String(precision)}`);
    assert.ok(recall >= 0.9, `recall ${String(recall)}`);
  });

  for (const sample of samples) {
    it(`${sample.label}/${sample.name} is ${sample.label === "bad" ? "flagged" : "not flagged"}`, () => {
      assert.equal(sample.flagged, sample.label === "bad", JSON.stringify(sample.rules));
    });
  }
});
