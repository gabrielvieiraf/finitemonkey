import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { type Budgets, evaluate, parseBudgets, summary } from "../scripts/budget-eval.js";
import { measureContext, withFixtureProject } from "../scripts/budget-measure.js";
import { ROOT } from "./support.js";

const budgets = parseBudgets(readFileSync(join(ROOT, "budgets.json"), "utf8"));

const sample: Budgets = { context: { sessionStartBytes: 0 }, latency: { preToolUseP95MsPerGuard: 50, runs: 1 } };

describe("budgets.json", () => {
  it("fixed context stays within its ceilings for a fresh project", async () => {
    const rows = await withFixtureProject(async (root) => evaluate(budgets, await measureContext(root), []));
    assert.deepEqual(
      rows.filter((row) => !row.ok).map((row) => `${row.name} ${String(row.value)} > ${String(row.ceiling)}`),
      [],
    );
  });

  it("a measure over its ceiling fails", () => {
    const [row] = evaluate(sample, [{ name: "sessionStartBytes", value: 12 }], []);
    assert.equal(row?.ok, false);
  });

  it("a measure without a ceiling fails, so a new one must be budgeted in the file", () => {
    const [row] = evaluate(sample, [{ name: "newHookBytes", value: 0 }], []);
    assert.deepEqual([row?.ok, row?.ceiling], [false, undefined]);
  });

  it("latency is judged per guard", () => {
    const rows = evaluate(
      sample,
      [],
      [
        { name: "fastGuard", value: 3 },
        { name: "slowGuard", value: 51 },
      ],
    );
    assert.deepEqual(
      rows.map((row) => [row.name, row.ok]),
      [
        ["fastGuard", true],
        ["slowGuard", false],
      ],
    );
  });

  it("the summary prints every number next to its ceiling", () => {
    const text = summary(
      evaluate(sample, [{ name: "sessionStartBytes", value: 0 }], [{ name: "gitPreToolUse", value: 7.25 }]),
    );
    assert.match(text, /\| sessionStartBytes \| 0 B \| 0 B \| ok \|/);
    assert.match(text, /\| PreToolUse p95: gitPreToolUse \| 7\.3 ms \| 50\.0 ms \| ok \|/);
  });
});
