import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { computeMetrics, type MeasureResult, renderMetrics } from "../scripts/bench-metrics-lib.js";
import { MEASURES } from "../scripts/bench-metrics-measures.js";
import { loadRuns } from "../scripts/bench-metrics-read.js";
import { ROOT } from "./support.js";

const FIXTURE = join(ROOT, "test", "fixtures", "bench-metrics");
const SIZES = { "cart-total": "M", "notes-idor": "S" };

const PENDING = [273, 283, 285, 288, 289, 299, 300, 301, 310, 311, 326, 328, 335, 342, 124];

const report = () => {
  const runs = loadRuns(FIXTURE);
  assert.ok(runs.ok);
  return computeMetrics("fixture", { runs: runs.value, sizes: SIZES });
};

const byId = (id: string): MeasureResult => {
  const found = report().measures.find((result) => result.id === id);
  assert.ok(found, id);
  return found;
};

const groups = (id: string): Readonly<Record<string, readonly [number, number]>> => {
  const result = byId(id);
  if (result.status !== "computed") return assert.fail(`${id} is ${result.status}`);
  return Object.fromEntries(result.groups.map((group) => [group.group, [group.value, group.n] as const]));
};

describe("bench metrics", () => {
  it("covers every pending measure with a computation or a written reason", () => {
    const covered = new Set(MEASURES.flatMap((measure) => measure.issues));
    assert.deepEqual(
      PENDING.filter((issue) => !covered.has(issue)),
      [],
    );
    for (const result of report().measures) {
      if (result.status === "not_local") assert.ok(result.reason.length > 20, result.id);
    }
  });

  it("computes every local measure from the fixture log, with n and the source file", () => {
    for (const result of report().measures) {
      if (result.status === "not_local") continue;
      if (result.status !== "computed") return assert.fail(`${result.id} is ${result.status}`);
      assert.ok(result.n > 0);
      assert.ok(result.source.includes(".jsonl"));
    }
  });

  it("aggregates run records per arm", () => {
    assert.deepEqual(groups("tokens-per-task"), { fm: [2400, 2], plain: [1200, 1] });
    assert.deepEqual(groups("time-per-task"), { fm: [40, 2], plain: [20, 1] });
    assert.deepEqual(groups("tokens-per-turn"), { fm: [800, 2], plain: [600, 1] });
    assert.deepEqual(groups("cost-per-task"), { fm: [0.06, 2], plain: [0.02, 1] });
    assert.deepEqual(groups("false-done-by-arm"), { fm: [0, 2], plain: [1, 1] });
    assert.deepEqual(groups("false-done-by-size"), { "fm M": [0, 1], "fm S": [0, 1], "plain M": [1, 1] });
  });

  it("reads per-run logs for questions, approvals, probes, mutants and findings", () => {
    assert.deepEqual(groups("oracle-green-after-question"), {
      "fm asked": [1, 1],
      "fm not asked": [0, 1],
      "plain not asked": [0, 1],
    });
    assert.deepEqual(groups("time-to-approval"), { fm: [30, 2] });
    assert.deepEqual(groups("probe-right-rate"), { "fm judgment": [0, 1], "fm vocabulary": [1, 1] });
    assert.deepEqual(groups("mutation-kill-rate"), { fm: [0.6, 2] });
    assert.deepEqual(groups("security-findings"), { fm: [0, 2] });
  });

  it("says no data instead of a number when the runs lack the fields", () => {
    const empty = computeMetrics("empty", { runs: [{ record: { arm: "fm" }, log: [] }], sizes: {} });
    const tokens = empty.measures.find((result) => result.id === "tokens-per-task");
    assert.equal(tokens?.status, "no_data");
    assert.match(renderMetrics(empty), /0 of 15 measures computed/);
  });

  it("refuses a folder without runs.jsonl", () => {
    assert.equal(loadRuns(join(FIXTURE, "runs")).ok, false);
  });
});
