import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { Runtime } from "../src/core/runtime.js";
import { readLedgerChecked } from "../src/evidence/ledger.js";
import { keyPath } from "../src/evidence/sign.js";
import { EVIDENCE_SCHEMA } from "../src/evidence/types.js";
import { gitAt, treeHash } from "../src/gate/git.js";
import { runGate } from "../src/gate/run.js";
import { VENDOR_BIN } from "../src/install/layout.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
const homes: string[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

const homeRuntime = (): Runtime => {
  const home = mkdtempSync(join(tmpdir(), "fm-home-"));
  homes.push(home);
  return { ...repoRuntime(), homeDir: () => home };
};

const fresh = (test = PASSING_TEST): Repo => {
  const repo = makeRepo({ "src/a.js": "export const a = 1;\n", "test/a.test.js": test });
  repos.push(repo);
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
    id: "t1",
    goal: "change a",
    size: "S",
    base: repo.git("rev-parse", "HEAD").trim(),
    paths: [],
    runs: [],
    tests: "node --test",
    git: [],
    manual: [],
    budget: undefined,
  });
  assert.ok(created.ok);
  repo.write("src/a.js", "export const a = 2;\n");
  return repo;
};

const gate = (repo: Repo, runtime: Runtime) => {
  const run = runGate({ runtime, cwd: repo.root, env: {}, sessionId: "s1", budgetMs: 60_000, fast: false });
  if (run.kind !== "done") throw new Error(`gate did not run: ${JSON.stringify(run)}`);
  return run.report;
};

const rawTestLines = (repo: Repo): number =>
  readFileSync(fmPaths(repo.root).evidence("t1"), "utf8")
    .split("\n")
    .filter((line) => line.includes('"check":"tests"')).length;

describe("signed evidence ledger", () => {
  it("a hand-written passed line is ignored and reported as tampering", () => {
    const runtime = homeRuntime();
    const repo = fresh(PASSING_TEST.replace("1 + 1, 2", "1 + 1, 3"));
    const tree = treeHash(gitAt(runtime, repo.root)) ?? "";
    const forged = {
      schema: EVIDENCE_SCHEMA,
      task: "t1",
      check: "tests",
      kind: "tests",
      status: "passed",
      treeHash: tree,
      at: new Date().toISOString(),
      notes: [],
      command: "node --test",
    };
    runtime.appendText(fmPaths(repo.root).evidence("t1"), `${JSON.stringify(forged)}\n`);
    const report = gate(repo, runtime);
    assert.equal(report.items.find((item) => item.id === "tests")?.status, "failed");
    assert.equal(report.tampered, 1);
    assert.equal(readLedgerChecked(runtime, fmPaths(repo.root).evidence("t1")).tampered, 1);
  });

  it("a modified hook script makes the gate run the checks again instead of reusing evidence", () => {
    const runtime = homeRuntime();
    const repo = fresh();
    gate(repo, runtime);
    gate(repo, runtime);
    assert.equal(rawTestLines(repo), 1);
    repo.write(VENDOR_BIN, "// patched\n");
    gate(repo, runtime);
    assert.equal(rawTestLines(repo), 2);
  });

  it("a missing key is created again and the old evidence is not trusted", () => {
    const runtime = homeRuntime();
    const repo = fresh();
    gate(repo, runtime);
    rmSync(keyPath(runtime));
    gate(repo, runtime);
    assert.equal(rawTestLines(repo), 2);
    const checked = readLedgerChecked(runtime, fmPaths(repo.root).evidence("t1"));
    assert.ok(checked.oldKey > 0);
    assert.equal(checked.tampered, 0);
    assert.equal(checked.entries.filter((entry) => entry.check === "tests").length, 1);
  });
});
