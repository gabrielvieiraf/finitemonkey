import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { costFile, costOf, parseSteps, recordSteps } from "../src/bridge/cost.js";
import { statusOf } from "../src/bridge/status.js";
import { appendEvidence } from "../src/evidence/ledger.js";
import { type Evidence, EVIDENCE_SCHEMA } from "../src/evidence/types.js";
import { costLines } from "../src/mod/cost-hooks.js";
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
    const status = statusOf(runtime, paths, { ANTHROPIC_API_KEY: "set" });
    assert.deepEqual(status.cost, { usd: cost.usd, requests: 2 });
    assert.equal(status.costTokens, 7080);
    assert.equal(status.billing, "api");
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

  it("shows build and verification cost of a task separately, with gate run minutes", () => {
    const repo = makeRepo({});
    repos.push(repo);
    const runtime = repoRuntime();
    const paths = fmPaths(repo.root);
    writeState(runtime, paths, { active: "t1", done: [] });
    const line = (usd: number, agent: string | null, kind?: string): string =>
      `${JSON.stringify({ model: "m", agent, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, at: "2026-10-26T12:00:00Z", task: "t1", arms: [], usd, ...(kind === undefined ? {} : { kind }) })}\n`;
    runtime.appendText(
      costFile(paths),
      [
        line(3, null),
        line(1, "a1"),
        line(0.5, "verifier"),
        line(0.25, "fm:reviewer"),
        line(0.25, null, "provider"),
      ].join(""),
    );
    const evidence = (check: string, durationMs: number): Evidence => ({
      schema: EVIDENCE_SCHEMA,
      task: "t1",
      check,
      kind: "command",
      status: "passed",
      treeHash: "abc",
      at: "2026-10-26T12:00:00Z",
      notes: [],
      durationMs,
    });
    assert.ok(appendEvidence(runtime, paths.evidence("t1"), [evidence("A1", 90_000), evidence("A2", 30_000)]));
    const cost = costOf(runtime, paths);
    assert.deepEqual(cost.build, { usd: 4, requests: 2 });
    assert.deepEqual(cost.verification, { usd: 1, requests: 3, gateMinutes: 2, share: 0.2 });
    assert.equal(cost.usd, 5);
    assert.ok(costLines(JSON.stringify(cost)).includes("build $4.00 · verification $1.00 + gate 2 min"));
  });
});
