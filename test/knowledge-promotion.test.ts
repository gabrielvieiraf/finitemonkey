import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { appendEvidence } from "../src/evidence/ledger.js";
import { GATE_CHECK } from "../src/evidence/types.js";
import { readClaimUse } from "../src/knowledge/use.js";
import { fmPaths } from "../src/task/paths.js";
import { contextOf, fireHook, policyWith } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const setup = (guards: Readonly<Record<string, string>>): Repo => {
  const repo = makeRepo({
    "src/billing.ts": "export function roundTotal(value: number): number {\n  return Math.round(value);\n}\n",
    ".fm/policy.yml": policyWith(guards),
    ".fm/state.json": `${JSON.stringify({ schemaVersion: 1, active: "t1", done: [] })}\n`,
  });
  repos.push(repo);
  return repo;
};

const run = (repo: Repo, args: readonly string[]) => cliJson(args, { cwd: repo.root, runtime: repoRuntime() });

const add = async (repo: Repo, text: string): Promise<string> => {
  const added = await run(repo, ["claims", "add", text, "--anchor", "src/billing.ts#roundTotal"]);
  assert.equal(added.code, 0, added.stdout);
  return String(field(added.body, "data", "id"));
};

const gatePassed = (repo: Repo, task: string): void => {
  appendEvidence(repoRuntime(), fmPaths(repo.root).evidence(task), [
    {
      schema: "finitemonkey/evidence@1",
      task,
      check: GATE_CHECK,
      kind: "gate",
      status: "passed",
      treeHash: "wabc",
      at: new Date(Date.now() + 60_000).toISOString(),
      notes: [],
    },
  ]);
};

const statuses = async (repo: Repo): Promise<Readonly<Record<string, unknown>>> => {
  const list = await run(repo, ["claims", "list"]);
  const claims = field(list.body, "data", "claims");
  return Object.fromEntries(
    (Array.isArray(claims) ? claims : []).map((item) => [String(field(item, "id")), field(item, "status")]),
  );
};

describe("promotion by direct use", () => {
  it("promotes a claim retrieved in a task that ends green and leaves one never used in quarantine", async () => {
    const repo = setup({ "knowledge-claims": "active", "claim-promotion": "active" });
    const used = await add(repo, "invoices follow the dunning calendar");
    const unused = await add(repo, "refunds settle within ninety days");
    const answer = await run(repo, ["retrieve", "dunning calendar"]);
    assert.equal(field(answer.body, "data", "step"), "bm25");
    assert.deepEqual(
      readClaimUse(repoRuntime(), fmPaths(repo.root)).map((use) => [use.via, use.ids, use.task]),
      [["retrieve", [used], "t1"]],
    );
    gatePassed(repo, "t1");
    assert.deepEqual(await statuses(repo), { [used]: "valid", [unused]: "quarantined" });
    assert.match(repo.read(".fm/claims.jsonl"), new RegExp(`"event":"promote","id":"${used}"`));
    assert.doesNotMatch(repo.read(".fm/claims.jsonl"), new RegExp(`"event":"promote","id":"${unused}"`));
  });

  it("does not promote a use whose green gate belongs to another task", async () => {
    const repo = setup({ "knowledge-claims": "active", "claim-promotion": "active" });
    const used = await add(repo, "invoices follow the dunning calendar");
    await run(repo, ["retrieve", "dunning calendar"]);
    gatePassed(repo, "t2");
    assert.deepEqual(await statuses(repo), { [used]: "quarantined" });
  });

  it("records claims injected at session start as used", async () => {
    const repo = setup({ "knowledge-claims": "active" });
    const injected = await add(repo, "invoices follow the dunning calendar");
    const started = await fireHook(repo, "SessionStart", { source: "startup" });
    assert.match(contextOf(started), /dunning calendar/);
    gatePassed(repo, "t1");
    await statuses(repo);
    assert.match(repo.read(".fm/claims.jsonl"), new RegExp(`"event":"promote","id":"${injected}"`));
  });
});
