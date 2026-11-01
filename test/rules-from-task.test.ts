import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { appendEvidence } from "../src/evidence/ledger.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const RULES = "schemaVersion: 1\nrules: []\n";

const failedTests = (at: string, failures: readonly string[]) => ({
  schema: "finitemonkey/evidence@1" as const,
  task: "t1",
  check: "tests",
  kind: "tests",
  status: "failed" as const,
  treeHash: "wabc",
  at,
  notes: [],
  failures,
});

const setup = (): Repo => {
  const repo = makeRepo({ ".finitemonkey/rules.yml": RULES });
  repos.push(repo);
  appendEvidence(repoRuntime(), fmPaths(repo.root).evidence("t1"), [
    failedTests("2026-10-01T10:00:00.000Z", ["money > rounds half up", "money > parses null"]),
    failedTests("2026-10-01T10:05:00.000Z", ["money > rounds half up"]),
  ]);
  return repo;
};

const proposals = (body: unknown): readonly unknown[] => {
  const value = field(body, "data", "proposals");
  return Array.isArray(value) ? value : [];
};

describe("rules propose --from-task", () => {
  it("lists a rule for a finding repeated in the task and nothing for a single one", async () => {
    const repo = setup();
    const listed = await cliJson(["rules", "propose", "--from-task", "t1"], {
      cwd: repo.root,
      runtime: repoRuntime(),
      env: { CLAUDECODE: "1" },
    });
    assert.equal(listed.code, 0, listed.stdout);
    const found = proposals(listed.body);
    assert.equal(found.length, 1);
    assert.match(String(field(found[0], "text")), /tests.*money > rounds half up/);
    assert.equal(field(found[0], "origin"), "task t1");
    assert.deepEqual(field(listed.body, "data", "written"), []);
    assert.equal(repo.read(".finitemonkey/rules.yml"), RULES);
  });

  it("refuses to write without a person confirming", async () => {
    const repo = setup();
    const forced = await cliJson(["rules", "propose", "--from-task", "t1", "--yes"], {
      cwd: repo.root,
      runtime: repoRuntime(),
      env: { CLAUDECODE: "1" },
    });
    assert.notEqual(forced.code, 0);
    assert.equal(repo.read(".finitemonkey/rules.yml"), RULES);
  });

  it("lists nothing for a task without repeated findings", async () => {
    const repo = setup();
    const listed = await cliJson(["rules", "propose", "--from-task", "t9"], {
      cwd: repo.root,
      runtime: repoRuntime(),
      env: { CLAUDECODE: "1" },
    });
    assert.deepEqual(proposals(listed.body), []);
  });
});
