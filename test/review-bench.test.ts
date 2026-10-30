import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { parseReviewEvidence } from "../scripts/evidence-rates.js";
import {
  armFindings,
  costEstimate,
  critiqueFrom,
  type GoldenPr,
  judgeInputs,
  parseGolden,
  parsePin,
  parseRecord,
  pullOf,
  realReviewProblems,
  type ReviewDeps,
  reviewOne,
} from "../scripts/review-bench-lib.js";
import { judgeModelDir, scoreArms } from "../scripts/review-bench-score.js";
import { isRecord, parseJsonObject } from "../src/core/parsed.js";
import type { Finding } from "../src/review/findings.js";
import { ROOT } from "./support.js";

const PR: GoldenPr = {
  url: "https://github.com/acme/shop/pull/7",
  title: "Cart: apply coupons",
  repo: "shop",
  comments: [
    { comment: "Race on the stock count", severity: "High", category: "concurrency" },
    { comment: "Coupon applied twice", severity: "Medium", category: "bug" },
  ],
};

const CRITIQUE = {
  verdict: "request-changes",
  findings: [
    {
      group: "must",
      what: "Double discount",
      problem: "The coupon is applied twice",
      fix: "Apply once",
      ifNotFixed: "Wrong totals",
      repro: { command: "npm test", expect: "fails" },
    },
    { group: "should", what: "Naming", problem: "unclear name", fix: "rename", ifNotFixed: "confusion" },
  ],
};

const fakeDeps = (text: string, calls: string[]): ReviewDeps => ({
  review: (pr) => {
    calls.push(`review ${pr.url}`);
    return Promise.resolve({ text, costUsd: 0.5 });
  },
  verify: (_pr, findings: readonly Finding[]) => {
    calls.push(`verify ${String(findings.length)}`);
    return Promise.resolve(new Map([[1, "head-only" as const]]));
  },
});

const toolOf = (review: unknown): unknown => (isRecord(review) ? review["tool"] : undefined);

describe("review bench", () => {
  it("the pinned benchmark is a full commit and its estimate is well formed", () => {
    const raw = parseJsonObject(readFileSync(join(ROOT, "bench", "review", "martian.json"), "utf8"));
    assert.ok(raw.ok);
    const pin = parsePin(raw.value);
    assert.ok(pin.ok, pin.ok ? "" : pin.error);
    assert.match(pin.value.commit, /^[0-9a-f]{40}$/);
    assert.equal(parsePin({ ...raw.value, commit: "main" }).ok, false);
  });

  it("reads golden comments in the benchmark's format", () => {
    const parsed = parseGolden("shop", [
      { pr_title: "Cart", url: PR.url, comments: [{ comment: "x", severity: "Low", category: "bug" }] },
    ]);
    assert.ok(parsed.ok);
    assert.equal(parsed.value[0]?.comments.length, 1);
    assert.equal(parseGolden("shop", [{ url: PR.url, comments: [{ severity: "Low" }] }]).ok, false);
    assert.deepEqual(pullOf(PR.url), { owner: "acme", name: "shop", number: 7 });
  });

  it("prints a cost estimate and refuses to spend without --yes, a TTY, a config dir and the clones", () => {
    const estimate = costEstimate([PR], { reviewUsdPerPr: 1, candidatesPerPr: 5, judgeUsdPerPair: 0.01 }, 3);
    assert.equal(estimate.pairs, 2 * 5 * 2);
    assert.equal(estimate.reviewUsd, 1);
    assert.equal(estimate.reviewCapUsd, 3);
    assert.match(estimate.text, /1 PRs, 2 golden comments/);
    assert.equal(realReviewProblems({ yes: false, tty: false, configDir: undefined, repos: undefined }).length, 4);
    assert.deepEqual(realReviewProblems({ yes: true, tty: true, configDir: "/c", repos: "/r" }), []);
  });

  it("takes the last findings JSON block of the review and keeps the reproduction outcome", async () => {
    const calls: string[] = [];
    const text = `Findings below.\n\n\`\`\`json\n${JSON.stringify(CRITIQUE)}\n\`\`\`\n`;
    const record = await reviewOne(PR, fakeDeps(text, calls));
    assert.equal(record.error, null);
    assert.deepEqual(calls, [`review ${PR.url}`, "verify 2"]);
    assert.deepEqual(
      record.findings.map((finding) => [finding.group, finding.outcome]),
      [
        ["must", "head-only"],
        ["should", "not-run"],
      ],
    );
    assert.deepEqual(armFindings(record, "finitemonkey"), [
      "Double discount: The coupon is applied twice",
      "Naming: unclear name",
    ]);
    assert.deepEqual(armFindings(record, "finitemonkey-reproduced"), ["Double discount: The coupon is applied twice"]);
    const roundTrip = parseJsonObject(JSON.stringify(record));
    assert.ok(roundTrip.ok);
    assert.deepEqual(parseRecord(roundTrip.value), record);
  });

  it("a review without a findings block is an error, not an empty pass", async () => {
    const record = await reviewOne(PR, fakeDeps("Looks good to me.", []));
    assert.notEqual(record.error, null);
    assert.ok(Array.isArray(critiqueFrom("no json here")));
  });

  it("writes judge inputs for both arms and keeps other tools' reviews", async () => {
    const record = await reviewOne(PR, fakeDeps(`\`\`\`json\n${JSON.stringify(CRITIQUE)}\n\`\`\``, []));
    const existing = { [PR.url]: { reviews: [{ tool: "copilot", repo_name: "shop", pr_url: PR.url }] } };
    const { benchmarkData, candidates } = judgeInputs([PR], [record], existing, {});
    const entry = benchmarkData[PR.url];
    const reviews: unknown = isRecord(entry) ? entry["reviews"] : undefined;
    assert.deepEqual(Array.isArray(reviews) ? reviews.map(toolOf) : [], [
      "copilot",
      "finitemonkey",
      "finitemonkey-reproduced",
    ]);
    assert.deepEqual(candidates[PR.url], {
      finitemonkey: [{ text: "Double discount: The coupon is applied twice" }, { text: "Naming: unclear name" }],
      "finitemonkey-reproduced": [{ text: "Double discount: The coupon is applied twice" }],
    });
    assert.equal(judgeModelDir("anthropic/claude-sonnet-4-5"), "anthropic_claude-sonnet-4-5");
  });

  it("scores precision, recall and F1 per arm with n from the benchmark's evaluations", () => {
    const scores = scoreArms({
      a: {
        finitemonkey: { tp: 2, fp: 2, fn: 1, total_candidates: 4, total_golden: 3, errors_count: 0 },
        "finitemonkey-reproduced": { tp: 1, fp: 0, fn: 2, total_candidates: 1, total_golden: 3 },
        copilot: { tp: 3, fp: 0, fn: 0 },
      },
      b: { finitemonkey: { skipped: true }, "finitemonkey-reproduced": { tp: 0, fp: 0, fn: 2, total_golden: 2 } },
    });
    const [all, reproduced] = scores;
    assert.ok(all !== undefined && reproduced !== undefined);
    assert.deepEqual([all.reviews, all.skipped, all.tp, all.fp, all.fn], [1, 1, 2, 2, 1]);
    assert.equal(all.precision, 0.5);
    assert.equal(all.recall, 2 / 3);
    assert.ok(Math.abs(all.f1 - 4 / 7) < 1e-9);
    assert.deepEqual([reproduced.reviews, reproduced.precision, reproduced.recall], [2, 1, 0.2]);
    const evidence = parseReviewEvidence({ benchmark: "x/y", commit: "c", judgeModel: "m", arms: scores });
    assert.equal(evidence?.arms.length, 2);
  });
});
