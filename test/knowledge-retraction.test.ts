import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";
import { trustContract } from "./trusted-contract.js";

const MAX = ["export function larger(a, b) {", "  return a > b ? a : b;", "}", ""].join("\n");
const CONTRACT = [
  "id: t",
  "goal: compare",
  "acceptance:",
  "  - id: C1",
  "    check: command",
  "    run: node --version",
  "",
].join("\n");
const ALWAYS = `node -e "process.exit(0)"`;

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const project = (): TempRepo => {
  const repo = tempRepo({ "src/max.mjs": MAX });
  repos.push(repo);
  write(repo.root, ".finitemonkey/policy.yml", "guards:\n  claim-checks: active\n");
  write(
    repo.root,
    ".finitemonkey/decisions.jsonl",
    `${JSON.stringify({
      id: "d1",
      source: "decide",
      at: "2026-10-01T10:00:00.000Z",
      subject: "monthly billing",
      recommendation: "keep monthly",
      evidence: ["assumption:a1"],
      decision: "followed",
      paths: [],
    })}\n`,
  );
  trustContract(repo.root, "t", CONTRACT);
  return repo;
};

const run = (repo: TempRepo, args: readonly string[]) => cliJson(args, { cwd: repo.root, runtime: repoRuntime() });

const add = async (repo: TempRepo, ...args: readonly string[]): Promise<string> => {
  const added = await run(repo, ["claims", "add", ...args]);
  assert.equal(added.code, 0, added.stdout);
  return String(field(added.body, "data", "id"));
};

const listed = async (
  repo: TempRepo,
): Promise<{ readonly status: (id: string) => unknown; readonly body: unknown }> => {
  const list = await run(repo, ["claims", "list"]);
  const claims = field(list.body, "data", "claims");
  return {
    status: (id) =>
      Array.isArray(claims)
        ? field(
            claims.find((item) => field(item, "id") === id),
            "status",
          )
        : undefined,
    body: list.body,
  };
};

const reasonOf = (body: unknown, id: string): unknown => {
  const claims = field(body, "data", "claims");
  return Array.isArray(claims)
    ? field(
        claims.find((item) => field(item, "id") === id),
        "reason",
      )
    : undefined;
};

describe("retraction propagates to dependents", () => {
  it("refuting an assumption takes dependent claims and decisions out, with the chained reason", async () => {
    const repo = project();
    await run(repo, ["guardian", "assume", "add", "billing stays monthly | impact: high | verify: ask finance"]);
    const first = await add(
      repo,
      "invoices are monthly",
      "--anchor",
      "src/max.mjs#larger",
      "--because",
      "assumption:a1",
    );
    const second = await add(
      repo,
      "the dunning job runs monthly",
      "--anchor",
      "src/max.mjs",
      "--because",
      `claim:${first}`,
    );
    assert.equal((await listed(repo)).status(first), "valid");
    await run(repo, ["guardian", "assume", "verify", "a1", "--evidence", "finance moved to yearly", "--false"]);
    const after = await listed(repo);
    assert.equal(after.status(first), "out");
    assert.equal(after.status(second), "out");
    assert.match(String(reasonOf(after.body, first)), /assumption:a1 refuted/);
    assert.match(String(reasonOf(after.body, second)), new RegExp(`claim:${first} out <- assumption:a1 refuted`));
    assert.match(JSON.stringify(field(after.body, "data", "decisions")), /decision:d1.*assumption:a1 refuted/);
  });

  it("brings a dependent back only after its own check passes once the premise holds again", async () => {
    const repo = project();
    await run(repo, ["guardian", "assume", "add", "billing stays monthly | impact: high | verify: ask finance"]);
    const id = await add(
      repo,
      "larger is used",
      "--anchor",
      "src/max.mjs#larger",
      "--check",
      ALWAYS,
      "--because",
      "assumption:a1",
    );
    await run(repo, ["guardian", "assume", "verify", "a1", "--evidence", "no", "--false"]);
    assert.equal((await listed(repo)).status(id), "out");
    await run(repo, ["guardian", "assume", "verify", "a1", "--evidence", "yes after all"]);
    assert.equal((await listed(repo)).status(id), "out");
    write(repo.root, "src/max.mjs", MAX.replace("a > b ? a : b", "Math.max(a, b)"));
    await run(repo, ["gate"]);
    assert.equal((await listed(repo)).status(id), "valid");
  });

  it("creates no edge from text: unknown premises are refused and claim text is never parsed", async () => {
    const repo = project();
    const first = await add(repo, "invoices are monthly", "--anchor", "src/max.mjs#larger");
    const refused = await run(repo, [
      "claims",
      "add",
      "x",
      "--anchor",
      "src/max.mjs",
      "--because",
      "the code looks monthly",
    ]);
    assert.notEqual(refused.code, 0);
    const mentions = await add(repo, `this follows from claim:${first}`, "--anchor", "src/max.mjs");
    const why = await run(repo, ["claims", "why", mentions]);
    assert.doesNotMatch(why.stdout, /"label":"claim","detail":"c-[0-9a-f]+ invoices/);
  });
});
