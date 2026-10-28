import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { Runtime } from "../src/core/runtime.js";
import { readLedger } from "../src/evidence/ledger.js";
import { reportLines } from "../src/gate/render.js";
import { runGate } from "../src/gate/run.js";
import { createTranslator } from "../src/i18n/translate.js";
import { createTask, type TaskDraft } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, NO_PR, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";
import { SAMPLES } from "./secret-samples.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const fresh = (): Repo => {
  const repo = makeRepo({ "src/a.js": "export const a = 1;\n", "test/a.test.js": PASSING_TEST });
  repos.push(repo);
  return repo;
};

const task = (repo: Repo, overrides: Partial<TaskDraft> = {}): void => {
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
    ...overrides,
  });
  assert.ok(created.ok);
};

const gate = (repo: Repo, fast = false, runtime = repoRuntime()) =>
  runGate({ runtime, cwd: repo.root, env: {}, sessionId: "s1", budgetMs: 60_000, fast });

const done = (run: ReturnType<typeof gate>) => {
  if (run.kind !== "done") throw new Error(`gate did not run: ${JSON.stringify(run)}`);
  return run.report;
};

const status = (report: ReturnType<typeof done>, id: string): string | undefined =>
  report.items.find((item) => item.id === id)?.status;

describe("gate", () => {
  it("passes a real green change and records evidence tied to the tree", () => {
    const repo = fresh();
    task(repo);
    repo.write("src/a.js", "export const a = 2;\n");
    const report = done(gate(repo));
    assert.equal(status(report, "tests"), "passed");
    assert.equal(status(report, "placeholders"), "passed");
    assert.equal(status(report, "pr"), "unverified");
    assert.equal(report.verdict, "incomplete");
    const ledger = readLedger(repoRuntime(), fmPaths(repo.root).evidence("t1"));
    const tests = ledger.find((entry) => entry.check === "tests");
    assert.equal(tests?.exitCode, 0);
    assert.equal(tests.treeHash, report.treeHash);
    assert.match(tests.stdoutSha256 ?? "", /^[0-9a-f]{64}$/);
    assert.equal(tests.testCount, 2);
  });

  it("fails when a test fails and lists the new failure", () => {
    const repo = fresh();
    task(repo, { paths: ["src/**", "test/**"] });
    repo.write("test/a.test.js", PASSING_TEST.replace("1 + 1, 2", "1 + 1, 3"));
    const report = done(gate(repo));
    assert.equal(report.verdict, "failed");
    const item = report.items.find((entry) => entry.id === "tests");
    assert.equal(item?.status, "failed");
    assert.ok(item.notes.some((entry) => entry.key === "gate.note.new_failure" && entry.params["name"] === "adds"));
  });

  it("evidence from another tree is stale: an edit after green runs the check again", () => {
    const repo = fresh();
    task(repo);
    repo.write("src/a.js", "export const a = 2;\n");
    const first = done(gate(repo));
    const ledgerPath = fmPaths(repo.root).evidence("t1");
    const count = readLedger(repoRuntime(), ledgerPath).filter((entry) => entry.check === "tests").length;
    done(gate(repo));
    assert.equal(readLedger(repoRuntime(), ledgerPath).filter((entry) => entry.check === "tests").length, count);
    repo.write("src/a.js", "export const a = 3;\n");
    const second = done(gate(repo));
    assert.notEqual(second.treeHash, first.treeHash);
    assert.equal(readLedger(repoRuntime(), ledgerPath).filter((entry) => entry.check === "tests").length, count + 1);
  });

  it("fast path: a second stop on the same green tree runs nothing at all", () => {
    const repo = fresh();
    task(repo);
    repo.write("src/a.js", "export const a = 2;\n");
    const calls: string[] = [];
    const base = repoRuntime({ gh: NO_PR });
    const runtime: Runtime = {
      ...base,
      exec: (request) => {
        if (request.command !== "git") calls.push(request.command);
        return base.exec(request);
      },
    };
    assert.equal(done(gate(repo, true, runtime)).verdict, "passed");
    const first = calls.length;
    assert.ok(first > 0);
    const again = done(gate(repo, true, runtime));
    assert.equal(again.fastPath, true);
    assert.equal(again.verdict, "passed");
    assert.equal(calls.length, first);
  });

  it("a missing tool is not verified, never passed", () => {
    const repo = fresh();
    task(repo, { runs: ["definitely-not-a-real-tool-fm --check"], tests: undefined });
    repo.write("src/a.js", "export const a = 2;\n");
    const report = done(gate(repo));
    const item = report.items.find((entry) => entry.id === "C1");
    assert.equal(item?.status, "unverified");
    assert.equal(item.reason, "tool_missing");
  });

  it("a rate limit is not verified, never passed nor failed", () => {
    const repo = fresh();
    task(repo, { runs: [`node -e "console.error('429 Too Many Requests'); process.exit(1)"`], tests: undefined });
    repo.write("src/a.js", "export const a = 2;\n");
    const item = done(gate(repo)).items.find((entry) => entry.id === "C1");
    assert.equal(item?.status, "unverified");
    assert.equal(item.reason, "rate_limited");
  });

  it("the report never prints a secret from a command or its output", () => {
    const repo = fresh();
    task(repo, { runs: [`node -e "console.log('${SAMPLES.githubPat}'); process.exit(1)"`], tests: undefined });
    repo.write("src/a.js", "export const a = 2;\n");
    const text = reportLines(createTranslator("en"), done(gate(repo))).join("\n");
    assert.doesNotMatch(text, new RegExp(SAMPLES.githubPat));
    assert.match(text, /«secret:[^»]+»/);
  });

  const theater = [
    ["echo tests passed", "gate.note.trivial"],
    ["true", "gate.note.trivial"],
    ["exit 0", "gate.note.trivial"],
    [":", "gate.note.trivial"],
    [`node -e "console.log('No tests found, exiting with code 0')"`, "gate.note.zero_tests"],
  ] as const;
  for (const [command, key] of theater) {
    it(`rejects theater: ${command}`, () => {
      const repo = fresh();
      task(repo, { runs: [command], tests: undefined });
      repo.write("src/a.js", "export const a = 2;\n");
      const item = done(gate(repo)).items.find((entry) => entry.id === "C1");
      assert.equal(item?.status, "failed", JSON.stringify(item));
      assert.ok(
        item.notes.some((entry) => entry.key === key),
        JSON.stringify(item.notes),
      );
    });
  }

  it("the tests check catches a skip added through any tool, from the tree diff", () => {
    const repo = fresh();
    task(repo);
    repo.write("test/a.test.js", PASSING_TEST.replace('test("adds"', 'test.skip("adds"'));
    const item = done(gate(repo)).items.find((entry) => entry.id === "tests");
    assert.equal(item?.status, "failed");
    assert.ok(item.notes.some((entry) => entry.key === "gate.tests.skip_added"));
  });

  it("finds placeholders and checks the scope and budget", () => {
    const repo = fresh();
    task(repo, { paths: ["src/**"], budget: { files: 1 }, tests: undefined, runs: [] });
    repo.write("src/a.js", "export const a = () => { throw new Error('not implemented'); };\n");
    repo.write("docs/x.txt", "outside\n");
    const report = done(gate(repo));
    assert.equal(status(report, "placeholders"), "failed");
    const diff = report.items.find((entry) => entry.id === "diff");
    assert.equal(diff?.status, "failed");
    assert.deepEqual(
      diff.notes.map((entry) => entry.key),
      ["gate.diff.outside", "gate.diff.too_many_files"],
    );
  });

  it("only new failures block: the baseline keeps old failures out", async () => {
    const repo = fresh();
    repo.write(
      "test/old.test.js",
      PASSING_TEST.replace('"adds", () => { assert.equal(1 + 1, 2)', '"old", () => { assert.equal(1, 2)'),
    );
    repo.commit("old failing test");
    task(repo);
    const { runBaseline } = await import("../src/gate/baseline-run.js");
    const { writeSession } = await import("../src/gate/baseline.js");
    const { gitAt, treeHash } = await import("../src/gate/git.js");
    const runtime = repoRuntime();
    writeSession(runtime, fmPaths(repo.root), {
      sessionId: "s1",
      startTree: treeHash(gitAt(runtime, repo.root)) ?? "",
      at: 0,
    });
    const baseline = runBaseline({ runtime, cwd: repo.root, env: {}, sessionId: "s1", budgetMs: 60_000, fast: false });
    assert.equal(baseline.kind, "recorded");
    repo.write("src/a.js", "export const a = 2;\n");
    const green = done(gate(repo));
    assert.equal(status(green, "tests"), "passed");
    assert.ok(
      green.items.find((entry) => entry.id === "tests")?.notes.some((entry) => entry.key === "gate.note.baseline"),
    );
    repo.write("test/a.test.js", PASSING_TEST.replace("1 + 1, 2", "1 + 1, 5"));
    assert.equal(status(done(gate(repo)), "tests"), "failed");
  });

  it("no changes in an implicit session means nothing to gate", () => {
    const repo = fresh();
    assert.deepEqual(gate(repo), { kind: "skipped", reason: "no_changes" });
  });

  it("an unwritable ledger is reported as a gate that did not run", () => {
    const repo = fresh();
    task(repo);
    repo.write("src/a.js", "export const a = 2;\n");
    assert.deepEqual(gate(repo, false, repoRuntime({ failAppend: true })), {
      kind: "failed",
      failure: { kind: "ledger_unwritable" },
    });
  });
});
