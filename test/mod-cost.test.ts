import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { costOf, parseSteps, recordSteps } from "../src/bridge/cost.js";
import { statusOf } from "../src/bridge/status.js";
import { DEFAULT_PRICES, priceOf, usdOf } from "../src/spend/prices.js";
import { fmPaths } from "../src/task/paths.js";
import { writeState } from "../src/task/state.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const STEPS = [
  { model: "claude-opus-5-5", agent: null, input: 1200, output: 300, cacheRead: 5000, cacheWrite: 100 },
  { model: "claude-haiku-4-5", agent: "a1", input: 400, output: 80, cacheRead: 0, cacheWrite: 0 },
];

describe("cost per contract and arm", () => {
  it("adds up the recorded API usage per contract and per experiment arm", () => {
    const repo = makeRepo({ ".finitemonkey/policy.yml": "experiments:\n  clarify: random\n" });
    repos.push(repo);
    const runtime = repoRuntime();
    const paths = fmPaths(repo.root);
    writeState(runtime, paths, { active: "t1", done: [] });
    assert.equal(recordSteps(runtime, paths, parseSteps(JSON.stringify(STEPS))), 2);
    const expected = STEPS.reduce((total, step) => total + usdOf(priceOf(DEFAULT_PRICES, step.model), step), 0);
    const cost = costOf(runtime, paths);
    assert.equal(cost.task, "t1");
    assert.equal(cost.requests, 2);
    assert.ok(Math.abs(cost.usd - expected) < 1e-9);
    assert.equal(cost.byArm.length, 1);
    assert.match(cost.byArm[0]?.arm ?? "", /^clarify=(off|shadow|active)$/);
    assert.ok(Math.abs((cost.byArm[0]?.usd ?? 0) - expected) < 1e-9);
    assert.deepEqual(statusOf(runtime, paths).cost, { usd: cost.usd, requests: 2 });
  });

  it("the loop count leaves the status while the alert budget mutes the fourth-attempt class", () => {
    const repo = makeRepo({});
    repos.push(repo);
    const runtime = repoRuntime();
    const paths = fmPaths(repo.root);
    repo.write(".finitemonkey/signals-index.json", JSON.stringify({ index: { error: { count: 2 } } }));
    assert.deepEqual(statusOf(runtime, paths).loop, { count: 2, limit: 4 });
    const now = Date.now();
    const firings = Array.from({ length: 12 }, (_, index) => now - index * 1000);
    repo.write(
      ".finitemonkey/cache/alert-budget.json",
      JSON.stringify({ "fourth-attempt": { fired: firings, dismissed: firings } }),
    );
    assert.equal(statusOf(runtime, paths).loop, null);
  });
});
