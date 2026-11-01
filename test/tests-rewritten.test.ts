import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { testsCheck } from "../src/gate/checks/tests.js";
import { prepareGate } from "../src/gate/prepare.js";
import { noteText } from "../src/gate/render.js";
import type { GateContext } from "../src/gate/types.js";
import { expiryFrom, saveRelease } from "../src/guards/release/grants.js";
import { createTranslator } from "../src/i18n/translate.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const CHECK = { id: "tests", kind: "tests" as const, run: "node --test" };
const REWRITTEN = PASSING_TEST.replace("assert.equal(1 + 1, 2)", 'assert.match(String(1 + 1).replace(/x/g, ""), /2/)');
const EXTENDED = `${PASSING_TEST}test("more", () => { assert.equal(2 + 2, 4); });\n`;

const project = (paths: readonly string[] = ["src/**", "test/**"]): Repo => {
  const repo = makeRepo({
    "package.json": '{ "scripts": { "test": "node --test" } }\n',
    "src/sum.js": "exports.sum = (a, b) => a + b;\n",
    "test/a.test.js": PASSING_TEST,
  });
  repos.push(repo);
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
    id: "t1",
    goal: "show the query above the results",
    size: "S",
    base: repo.git("rev-parse", "HEAD").trim(),
    paths,
    runs: [],
    tests: "node --test",
    git: [],
    manual: [],
    budget: undefined,
  });
  assert.ok(created.ok);
  return repo;
};

const context = (repo: Repo): GateContext => {
  const ready = prepareGate({
    runtime: repoRuntime(),
    cwd: repo.root,
    env: {},
    sessionId: "s1",
    budgetMs: 60_000,
    fast: false,
    noSkip: true,
  });
  if (ready.kind !== "ready") throw new Error(`not ready: ${ready.kind}`);
  return ready.prepared.ctx;
};

const approve = (repo: Repo, treeHash: string | undefined, check = "tests"): void => {
  const now = Date.now();
  saveRelease(repoRuntime(), fmPaths(repo.root), now, {
    grants: [],
    approvals: [
      {
        task: "t1",
        check,
        reason: "the old assertion did not know about the highlight",
        at: new Date(now).toISOString(),
        ...(treeHash === undefined ? {} : { treeHash }),
      },
    ],
  });
};

const keys = (notes: readonly { readonly key: string }[]): readonly string[] => notes.map((item) => item.key);

describe("a pass after the session changed an existing test", () => {
  it("is not verified without the person's word, even when the contract lists the test folder", () => {
    const repo = project();
    repo.write("test/a.test.js", REWRITTEN);
    const outcome = testsCheck(CHECK, context(repo));
    assert.equal(outcome.status, "unverified");
    assert.equal(outcome.reason, "awaiting_person");
    const rewritten = outcome.notes.find((item) => item.key === "gate.tests.rewritten");
    assert.deepEqual(rewritten?.params, { file: "test/a.test.js", removed: 1 });
    assert.ok(keys(outcome.notes).includes("gate.tests.rewritten_fix"));
    const approve = outcome.notes.find((item) => item.key === "gate.pin.approve");
    assert.deepEqual(approve?.params, { task: "t1", check: "tests" });
    assert.ok(keys(outcome.notes).includes("gate.tests.edited"));
  });

  it("says in plain words which test changed and how to put it back or approve it", () => {
    const repo = project();
    repo.write("test/a.test.js", REWRITTEN);
    const outcome = testsCheck(CHECK, context(repo));
    const t = createTranslator("en");
    const text = outcome.notes.map((item) => noteText(t, item)).join("\n");
    assert.match(
      text,
      /test\/a\.test\.js: a test that existed before this task was changed \(lines changed or removed: 1\)/,
    );
    assert.match(text, /put the test back as it was/);
    assert.match(text, /`fm: approve t1\/tests <reason>`/);
  });

  it("keeps tests added next to the existing ones as they are today", () => {
    const repo = project();
    repo.write("test/a.test.js", EXTENDED);
    repo.write("test/b.test.js", PASSING_TEST);
    const outcome = testsCheck(CHECK, context(repo));
    assert.equal(outcome.status, "passed");
    assert.ok(!keys(outcome.notes).includes("gate.tests.rewritten"));
  });

  it("passes once the test is put back as it was", () => {
    const repo = project();
    repo.write("test/a.test.js", REWRITTEN);
    assert.equal(testsCheck(CHECK, context(repo)).status, "unverified");
    repo.write("test/a.test.js", PASSING_TEST);
    assert.equal(testsCheck(CHECK, context(repo)).status, "passed");
  });

  it("passes after the person approves the change on this tree, with the approval on record", () => {
    const repo = project();
    repo.write("test/a.test.js", REWRITTEN);
    const ctx = context(repo);
    approve(repo, ctx.treeHash);
    const outcome = testsCheck(CHECK, ctx);
    assert.equal(outcome.status, "passed");
    assert.match(outcome.releasedBy ?? "", /^person@/);
    assert.ok(keys(outcome.notes).includes("gate.tests.rewritten_approved"));
  });

  it("accepts an approval addressed to the check's own id", () => {
    const repo = project();
    repo.write("test/a.test.js", REWRITTEN);
    const ctx = context(repo);
    approve(repo, ctx.treeHash, "unit");
    assert.equal(testsCheck({ ...CHECK, id: "unit" }, ctx).status, "passed");
  });

  it("asks again when the tree changed after the approval", () => {
    const repo = project();
    repo.write("test/a.test.js", REWRITTEN);
    approve(repo, "an-earlier-tree");
    const outcome = testsCheck(CHECK, context(repo));
    assert.equal(outcome.status, "unverified");
    assert.equal(outcome.reason, "needs_approval");
    assert.ok(keys(outcome.notes).includes("gate.approval.stale"));
  });

  it("passes when the person released the tests guard", () => {
    const repo = project();
    repo.write("test/a.test.js", REWRITTEN);
    const now = Date.now();
    saveRelease(repoRuntime(), fmPaths(repo.root), now, {
      grants: [
        {
          guard: "tests",
          reason: "the old test asserted the old markup",
          grantedAt: new Date(now).toISOString(),
          expiresAt: expiryFrom(now),
        },
      ],
      approvals: [],
    });
    const outcome = testsCheck(CHECK, context(repo));
    assert.equal(outcome.status, "passed");
    assert.ok(keys(outcome.notes).includes("gate.note.released"));
  });

  it("still fails when the suite fails, instead of waiting for the person", () => {
    const repo = project();
    repo.write("test/a.test.js", PASSING_TEST.replace("assert.equal(1 + 1, 2)", "assert.equal(1 + 1, 3)"));
    const outcome = testsCheck(CHECK, context(repo));
    assert.equal(outcome.status, "failed");
  });

  it("holds the check without a command as well", () => {
    const repo = project();
    repo.write("test/a.test.js", REWRITTEN);
    const outcome = testsCheck({ id: "tests", kind: "tests" }, context(repo));
    assert.equal(outcome.status, "unverified");
    assert.equal(outcome.reason, "awaiting_person");
  });
});
