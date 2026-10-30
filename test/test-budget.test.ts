import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { prepareGate } from "../src/gate/prepare.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import {
  linkedTests,
  parseCoverage,
  redundantTests,
  slowSuite,
  type SuiteRun,
  suiteRuns,
} from "../src/testbudget/budget.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const COVERAGE = parseCoverage({
  tests: {
    "adds two numbers": { lines: ["src/add.ts:1", "src/add.ts:2"], asserts: ["add(1,2)"] },
    "adds two numbers again": { lines: ["src/add.ts:1", "src/add.ts:2"], asserts: ["add(1,2)"] },
    "adds negatives": { lines: ["src/add.ts:1", "src/add.ts:2", "src/add.ts:3"], asserts: ["add(-1,-2)"] },
  },
});

const run = (index: number, ms: number): SuiteRun => ({
  treeHash: `t${String(index)}`,
  at: `2026-10-2${String(index)}T10:00:00.000Z`,
  ms,
});

describe("test suite budget", () => {
  it("two tests with identical coverage and assertions are listed as redundant, once", () => {
    assert.deepEqual(redundantTests(COVERAGE, []), [{ test: "adds two numbers again", coveredBy: "adds two numbers" }]);
  });

  it("a test marked keep is never listed again", () => {
    assert.deepEqual(redundantTests(COVERAGE, ["adds two numbers again"]), []);
  });

  it("a suite slower than the tolerance is reported against the median of the runs before it", () => {
    const steady = [run(1, 10_000), run(2, 11_000), run(3, 10_500)];
    assert.equal(slowSuite([...steady, run(4, 11_500)]), undefined);
    assert.deepEqual(slowSuite([...steady, run(4, 20_000)]), { currentMs: 20_000, baseMs: 10_500, runs: 3 });
    assert.equal(slowSuite([run(1, 100), run(2, 900)]), undefined, "below the 2 s floor");
  });

  it("reads one passed run per tree from the ledger, in time order", () => {
    const entry = (treeHash: string, at: string, durationMs: number) => ({
      schema: "finitemonkey/evidence@1" as const,
      task: "t1",
      check: "tests",
      kind: "tests",
      status: "passed" as const,
      treeHash,
      at,
      notes: [],
      durationMs,
    });
    const runs = suiteRuns([
      entry("b", "2026-10-02T00:00:00.000Z", 2),
      entry("a", "2026-10-01T00:00:00.000Z", 1),
      { ...entry("c", "2026-10-03T00:00:00.000Z", 3), status: "failed" as const },
    ]);
    assert.deepEqual(
      runs.map((item) => item.treeHash),
      ["a", "b"],
    );
  });
});

describe("inner loop selection", () => {
  it("selects only tests linked to the touched files, and the gate keeps the full suite", () => {
    const files: Readonly<Record<string, string>> = {
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 2;\n",
      "src/c.ts": 'import { a } from "./a.js";\nexport const c = a;\n',
      "test/a.test.ts": 'import { c } from "../src/c.js";\n',
      "test/b.test.ts": 'import { b } from "../src/b.js";\n',
    };
    const tree = { files: Object.keys(files), read: (path: string) => files[path], goModule: undefined };
    assert.deepEqual(linkedTests(tree, ["src/a.ts"]), ["test/a.test.ts"]);
    assert.deepEqual(linkedTests(tree, ["src/b.ts"]), ["test/b.test.ts"]);

    const repo = makeRepo({ ...files, ".gitignore": ".finitemonkey/*\n" });
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
    repo.write("src/a.ts", "export const a = 3;\n");
    const ready = prepareGate({
      runtime: repoRuntime(),
      cwd: repo.root,
      env: {},
      sessionId: "s1",
      budgetMs: 60_000,
      fast: false,
      noSkip: true,
    });
    if (ready.kind !== "ready") throw new Error(ready.kind);
    const kinds = ready.prepared.ctx.contract.acceptance.map((check) => [check.kind, check.run ?? ""]);
    assert.ok(kinds.some(([kind, command]) => kind === "tests" && command === "node --test"));
    assert.ok(kinds.some(([kind]) => kind === "test-budget"));
  });
});
