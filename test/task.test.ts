import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { createTask, type TaskDraft } from "../src/task/create.js";
import { detectChecks, implicitContract } from "../src/task/implicit.js";
import { loadTask } from "../src/task/load.js";
import { fmPaths } from "../src/task/paths.js";
import { readState, readTrust } from "../src/task/state.js";
import { validateContract } from "../src/task/validate.js";
import { memoryFs } from "./memory-fs.js";
import { fakeRuntime } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const paths = fmPaths(ROOT);

const valid = {
  id: "142-pix",
  goal: "Pay with Pix",
  acceptance: [
    { id: "A1", check: "command", run: "pnpm test" },
    { id: "A2", check: "git", require: ["committed", "pushed"] },
    { id: "A3", check: "manual", description: "Gabriel approves the copy" },
  ],
};

describe("task contract schema", () => {
  it("accepts a valid contract and fills defaults", () => {
    const parsed = validateContract(valid);
    assert.ok(parsed.ok);
    assert.equal(parsed.value.size, "S");
    assert.equal(parsed.value.scope.testsProtected, true);
    assert.deepEqual(parsed.value.acceptance[1]?.require, ["committed", "pushed"]);
  });

  const broken = [
    [{ ...valid, goal: undefined }, /goal: required/],
    [{ ...valid, id: "../escape" }, /id: use letters/],
    [{ ...valid, size: "XL" }, /size: use S, M, L/],
    [{ ...valid, acceptance: [] }, /at least one check/],
    [{ ...valid, acceptance: [{ id: "A1", check: "vibes" }] }, /check: use one of/],
    [{ ...valid, acceptance: [{ id: "A1", check: "command" }] }, /run: required/],
    [{ ...valid, acceptance: [{ id: "A1", check: "manual" }] }, /description: required/],
    [{ ...valid, acceptance: [{ id: "A1", check: "git", require: ["deployed"] }] }, /use committed, pushed, pr_open/],
    [
      {
        ...valid,
        acceptance: [
          { id: "A", check: "diff" },
          { id: "A", check: "tests" },
        ],
      },
      /duplicate id "A"/,
    ],
    [{ ...valid, scope: { diff_budget: { files: -1 } } }, /positive integer/],
    ["just text", /YAML mapping/],
  ] as const;
  for (const [value, message] of broken) {
    it(`rejects ${JSON.stringify(value).slice(0, 70)}`, () => {
      const parsed = validateContract(value);
      assert.ok(!parsed.ok);
      assert.match(parsed.error.join("\n"), message);
    });
  }
});

describe("implicit contract from the project", () => {
  const files = (map: Readonly<Record<string, string>>) => ({
    read: (path: string) => map[path],
    exists: (path: string) => path in map,
  });

  it("uses the package manager of the lockfile and the real scripts", () => {
    const checks = detectChecks(
      files({
        "package.json": JSON.stringify({ scripts: { typecheck: "tsc", lint: "eslint .", test: "vitest run" } }),
        "pnpm-lock.yaml": "",
      }),
    );
    assert.deepEqual(
      checks.map((check) => check.run),
      ["pnpm run typecheck", "pnpm run lint", "pnpm run test"],
    );
  });

  it("ignores the npm placeholder test script and falls back to check", () => {
    const checks = detectChecks(
      files({
        "package.json": JSON.stringify({
          scripts: { test: 'echo "Error: no test specified" && exit 1', check: "make" },
        }),
      }),
    );
    assert.deepEqual(
      checks.map((check) => check.run),
      ["npm run check"],
    );
  });

  it("knows other stacks", () => {
    assert.equal(detectChecks(files({ "Cargo.toml": "" }))[0]?.run, "cargo test");
    assert.equal(detectChecks(files({ "go.mod": "" }))[0]?.run, "go test ./...");
  });

  it("always protects tests, looks for placeholders and the PR", () => {
    const contract = implicitContract(files({}));
    assert.deepEqual(
      contract.acceptance.map((check) => check.kind),
      ["tests", "placeholders", "secrets", "pr"],
    );
    assert.equal(contract.implicit, true);
  });
});

const draft = (overrides: Partial<TaskDraft> = {}): TaskDraft => ({
  id: "t1",
  goal: "Fix the coupon",
  size: "S",
  base: "abc123",
  paths: ["src/cart/**"],
  runs: ['node -e "process.exit(0)"'],
  tests: undefined,
  git: ["committed"],
  manual: ["Ana approves"],
  budget: { files: 5 },
  ...overrides,
});

describe("task new", () => {
  it("writes the contract, approves it in the lock and makes it active", () => {
    const fs = memoryFs();
    const runtime = fakeRuntime({ fs });
    const created = createTask(runtime, paths, draft());
    assert.ok(created.ok);
    assert.deepEqual(
      created.value.contract.acceptance.map((check) => check.id),
      ["C1", "tests", "placeholders", "secrets", "diff", "git", "pr", "M1"],
    );
    assert.equal(readState(runtime, paths).active, "t1");
    assert.equal(readTrust(runtime, paths).approved["t1"], fs.read(paths.task("t1")));
    const loaded = loadTask(runtime, paths, { disk: () => undefined, base: () => undefined }, "t1");
    assert.ok(loaded.ok);
    assert.equal(loaded.value.trusted, true);
    assert.equal(loaded.value.source, "lock");
  });

  it("refuses to overwrite an existing task", () => {
    const runtime = fakeRuntime();
    assert.ok(createTask(runtime, paths, draft()).ok);
    const again = createTask(runtime, paths, draft());
    assert.ok(!again.ok);
    assert.equal(again.error.kind, "exists");
  });

  it("uses the approved version even when the file was edited in the diff", () => {
    const fs = memoryFs();
    const runtime = fakeRuntime({ fs });
    assert.ok(createTask(runtime, paths, draft()).ok);
    const edited = (fs.read(paths.task("t1")) ?? "").replace('node -e \\"process.exit(0)\\"', "echo ok");
    const loaded = loadTask(runtime, paths, { disk: () => edited, base: () => undefined }, "t1");
    assert.ok(loaded.ok);
    assert.equal(loaded.value.editedOnDisk, true);
    assert.equal(loaded.value.contract.acceptance[0]?.run, 'node -e "process.exit(0)"');
  });

  it("a contract that only exists on disk or in the base is not trusted", () => {
    const runtime = fakeRuntime();
    const text = "id: t9\ngoal: x\nacceptance:\n  - id: C1\n    check: command\n    run: make\n";
    for (const sources of [
      { disk: () => text, base: () => undefined },
      { disk: () => undefined, base: () => text },
    ]) {
      const loaded = loadTask(runtime, paths, sources, "t9");
      assert.ok(loaded.ok);
      assert.equal(loaded.value.trusted, false);
    }
  });
});
