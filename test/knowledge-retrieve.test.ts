import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { retrieve } from "../src/knowledge/retrieve.js";
import { armOf } from "../src/policy/experiment.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const setup = (extra: Readonly<Record<string, string>> = {}): Repo => {
  const repo = makeRepo({
    "src/billing/totals.ts":
      "export function roundTotal(value: number): number {\n  return Math.round(value * 100) / 100;\n}\n",
    "src/auth/session.ts": "export function openSession(): string {\n  return 'ok';\n}\n",
    ...extra,
  });
  repos.push(repo);
  return repo;
};

const run = (repo: Repo, args: readonly string[]) => cliJson(args, { cwd: repo.root, runtime: repoRuntime() });

describe("retrieval ladder", () => {
  it("answers a symbol with grep and records the step and its token cost", async () => {
    const repo = setup();
    const answer = await run(repo, ["retrieve", "where is roundTotal"]);
    assert.equal(answer.code, 0, answer.stdout);
    assert.equal(field(answer.body, "data", "step"), "grep");
    assert.match(JSON.stringify(field(answer.body, "data", "spans")), /src\/billing\/totals\.ts:1/);
    const log = repo.read(".finitemonkey/retrieve.jsonl");
    assert.match(log, /"step":"grep"/);
    assert.match(log, /"tokens":[1-9]/);
  });

  it("never returns a stale claim from the BM25 step", async () => {
    const repo = setup();
    await run(repo, [
      "claims",
      "add",
      "invoices follow the dunning calendar",
      "--anchor",
      "src/billing/totals.ts#roundTotal",
    ]);
    await run(repo, [
      "claims",
      "add",
      "invoices expire after ninety days",
      "--anchor",
      "src/auth/session.ts#openSession",
    ]);
    repo.write("src/auth/session.ts", "export function openSession(): string {\n  return 'changed';\n}\n");
    const answer = await run(repo, ["retrieve", "dunning invoices expire"]);
    assert.equal(field(answer.body, "data", "step"), "bm25");
    const spans = JSON.stringify(field(answer.body, "data", "spans"));
    assert.match(spans, /dunning calendar/);
    assert.doesNotMatch(spans, /ninety days/);
  });

  it("never reaches the deep step unless an arm turns it on", () => {
    const repo = setup();
    let calls = 0;
    const deep = () => {
      calls += 1;
      return [{ anchor: "x", text: "y" }];
    };
    const paths = fmPaths(repo.root);
    const missed = retrieve(repoRuntime(), paths, "zzqq nothing matches", { budget: 600, deep });
    assert.equal(missed.step, null);
    assert.equal(calls, 0);
    const task = Array.from({ length: 50 }, (_, index) => `task${String(index)}`).find(
      (id) => armOf(id, "retrieve-deep") === "active",
    );
    repo.write(".finitemonkey/policy.yml", "experiments:\n  retrieve-deep: random\n");
    repo.write(".finitemonkey/state.json", JSON.stringify({ schemaVersion: 1, active: task, done: [] }));
    const found = retrieve(repoRuntime(), paths, "zzqq nothing matches", { budget: 600, deep });
    assert.equal(found.step, "deep");
    assert.equal(calls, 1);
  });
});
