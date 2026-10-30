import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { bandLine, type GateView, parseStatus } from "../src/mod/status.js";
import { contextOf, fireHook, policyWith } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const TOTALS = [
  "export function total(items: number[]): number {",
  "  return Math.round(items.reduce((a, b) => a + b, 0) * 100) / 100;",
  "}",
  "",
  "export function tax(value: number): number {",
  "  return value * 0.1;",
  "}",
  "",
].join("\n");

const ASSUMPTION = JSON.stringify({
  id: "A1",
  text: "refunds never exceed the charge",
  source: "person",
  impact: "high",
  breaks: "refunds",
  confidence: "medium",
  verify: "npm test -- refunds",
  status: "unverified",
  at: "2026-10-29T10:00:00Z",
});

const setup = async (): Promise<Repo> => {
  const repo = makeRepo({
    "src/totals.ts": TOTALS,
    ".finitemonkey/policy.yml": policyWith({ "knowledge-claims": "active" }),
    ".finitemonkey/assumptions.jsonl": `${ASSUMPTION}\n`,
  });
  repos.push(repo);
  const run = (args: readonly string[]) => cliJson(args, { cwd: repo.root, runtime: repoRuntime() });
  await run(["claims", "add", "Totals round to cents", "--anchor", "src/totals.ts#total"]);
  await run(["claims", "add", "Tax is ten percent", "--anchor", "src/totals.ts#tax"]);
  repo.write("src/totals.ts", TOTALS.replace("value * 0.1", "value * 0.2"));
  return repo;
};

describe("knowledge in the band and in compaction", () => {
  it("stale claims never reach the compaction brief; valid claims and open assumptions do", async () => {
    const repo = await setup();
    const { body } = await cliJson(["handoff"], { cwd: repo.root, runtime: repoRuntime() });
    const text = String(field(body, "data", "text"));
    assert.match(text, /Project claims valid at tree/);
    assert.match(text, /Totals round to cents/);
    assert.doesNotMatch(text, /Tax is ten percent/);
    assert.match(text, /Open assumption A1 \(high impact\)/);
  });

  it("without mods, the PreCompact path brings back the same facts after compaction", async () => {
    const repo = await setup();
    await fireHook(repo, "PreCompact", { trigger: "auto" });
    const context = contextOf(await fireHook(repo, "SessionStart", { source: "compact" }));
    assert.match(context, /Totals round to cents/);
    assert.doesNotMatch(context, /Tax is ten percent/);
    assert.match(context, /Open assumption A1 \(high impact\): refunds never exceed the charge/);
  });

  it("the band shows the knowledge counts and hides the segment when they are all zero", async () => {
    const repo = await setup();
    const { stdout } = await cliJson(["status"], { cwd: repo.root, runtime: repoRuntime() });
    const view = parseStatus(stdout);
    assert.ok(view !== undefined);
    assert.deepEqual(view.knowledge, { stale: 1, contradictions: 0, quarantined: 0 });
    assert.match(bandLine(view), /knowledge: 1 stale · 0 rules contradict code · 0 in quarantine/);
    const zero: GateView = { ...view, knowledge: null };
    assert.doesNotMatch(bandLine(zero), /knowledge/);
    const parsedZero = parseStatus(stdout.replace('"stale":1', '"stale":0'));
    assert.equal(parsedZero?.knowledge, null);
  });
});
