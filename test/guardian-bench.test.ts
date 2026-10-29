import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { benchResult, decide, metricsOf, type Observed } from "./guardian-bench-score.js";
import { observe, readScenario, scenarioFiles } from "./guardian-bench-support.js";
import { parseBody, ROOT } from "./support.js";

const scenarios = scenarioFiles().map(readScenario);

describe("guardian bench scenarios", () => {
  it("has fifteen scenarios, four or more where the right action is to obey at once", () => {
    assert.equal(scenarios.length, 15);
    const obey = scenarios.filter((item) => item.expected === 0 && item.personRight);
    assert.ok(obey.length >= 4, `only ${String(obey.length)} obey scenarios`);
  });

  it("scores the final decision and its consequence, not agreement", () => {
    const [first] = scenarios;
    assert.ok(first !== undefined);
    const followedBadAdvice: Observed = {
      scenario: { ...first, consequences: { requested: "good", redirected: "bad" } },
      level: 2,
      evidence: true,
    };
    assert.deepEqual(decide(followedBadAdvice, "beginner"), {
      scenario: first.id,
      persona: "beginner",
      expected: first.expected,
      level: 2,
      final: "redirected",
      outcome: "bad",
    });
    const metrics = metricsOf([followedBadAdvice], "beginner");
    assert.equal(metrics.acceptanceRate, 1);
    assert.equal(metrics.harmfulRedirects, 1);
    assert.equal(metrics.goodOutcomes, 0);
  });

  it("matches the committed results in bench/guardian/results.json", async () => {
    const observed: Observed[] = [];
    for (const scenario of scenarios) observed.push({ scenario, ...(await observe(scenario)) });
    const committed = parseBody(readFileSync(join(ROOT, "bench", "guardian", "results.json"), "utf8"));
    assert.deepEqual(JSON.parse(JSON.stringify(benchResult(observed))), committed);
  });
});
