import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { gitAt, treeHash } from "../src/gate/git.js";
import { recordReview, reviewVerdict } from "../src/gate/review.js";
import { runGate } from "../src/gate/run.js";
import { saveRelease } from "../src/guards/release/grants.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const REVIEWER_OUTPUT = [
  "1. must fix: the charge is rounded twice.",
  "",
  "Verdict: request changes.",
  "",
  "```json",
  '{"verdict": "request-changes", "findings": []}',
  "```",
].join("\n");

const fresh = (files: Readonly<Record<string, string>> = {}): Repo => {
  const repo = makeRepo({ "src/a.js": "export const a = 1;\n", "test/a.test.js": PASSING_TEST, ...files });
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
    manual: ["the person looked at the screen"],
    budget: undefined,
  });
  assert.ok(created.ok);
  for (let index = 0; index < 6; index += 1)
    repo.write(`src/f${String(index)}.js`, `export const f = ${String(index)};\n`);
  return repo;
};

const tree = (repo: Repo): string => {
  const hash = treeHash(gitAt(repoRuntime(), repo.root));
  if (hash === undefined) throw new Error("no tree");
  return hash;
};

const item = (repo: Repo, id: string) => {
  const run = runGate({
    runtime: repoRuntime(),
    cwd: repo.root,
    env: {},
    sessionId: "s1",
    budgetMs: 60_000,
    fast: false,
  });
  if (run.kind !== "done") throw new Error(`gate did not run: ${JSON.stringify(run)}`);
  const found = run.report.items.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no ${id}: ${run.report.items.map((entry) => entry.id).join(", ")}`);
  return found;
};

describe("reviews and approvals bound to a verdict and a tree", () => {
  it("reads the verdict from the reviewer's JSON block, and nothing else", () => {
    assert.equal(reviewVerdict(REVIEWER_OUTPUT), "request-changes");
    assert.equal(reviewVerdict('{"verdict": "approve", "findings": []}'), "approve");
    assert.equal(reviewVerdict("Looks good to me, approve."), undefined);
  });

  it("a request-changes review fails the check; an approve passes it", () => {
    const repo = fresh();
    recordReview(
      repoRuntime(),
      fmPaths(repo.root),
      tree(repo),
      "finitemonkey:reviewer",
      reviewVerdict(REVIEWER_OUTPUT),
    );
    const rejected = item(repo, "size-review");
    assert.equal(rejected.status, "failed");
    assert.ok(rejected.notes.some((note) => note.key === "gate.review.rejected"));
    recordReview(repoRuntime(), fmPaths(repo.root), tree(repo), "finitemonkey:reviewer", "approve");
    assert.equal(item(repo, "size-review").status, "passed");
  });

  it("a review without a verdict is unverified", () => {
    const repo = fresh();
    recordReview(repoRuntime(), fmPaths(repo.root), tree(repo), "finitemonkey:reviewer");
    const silent = item(repo, "size-review");
    assert.equal(silent.status, "unverified");
    assert.equal(silent.reason, "no_verdict");
  });

  it("a reviewer agent created during the task is ignored; one from before the task counts", () => {
    const agent = "---\nname: x\n---\nReview.\n";
    const repo = fresh({ ".claude/agents/team-reviewer.md": agent });
    repo.write(".claude/agents/self-reviewer.md", agent);
    recordReview(repoRuntime(), fmPaths(repo.root), tree(repo), "self-reviewer", "approve");
    const ignored = item(repo, "size-review");
    assert.equal(ignored.status, "failed");
    assert.ok(
      ignored.notes.some((note) => note.key === "gate.review.untrusted" && note.params["agent"] === "self-reviewer"),
    );
    recordReview(repoRuntime(), fmPaths(repo.root), tree(repo), "team-reviewer", "approve");
    assert.equal(item(repo, "size-review").status, "passed");
  });

  it("an edit after a manual approval sets the check back to needs_approval", () => {
    const repo = fresh();
    const manual = item(repo, "M1");
    assert.equal(manual.reason, "awaiting_person");
    saveRelease(repoRuntime(), fmPaths(repo.root), Date.now(), {
      grants: [],
      approvals: [{ task: "t1", check: "M1", reason: "looked", at: new Date().toISOString(), treeHash: tree(repo) }],
    });
    assert.equal(item(repo, "M1").status, "passed");
    repo.write("src/a.js", "export const a = 3;\n");
    const stale = item(repo, "M1");
    assert.equal(stale.status, "unverified");
    assert.equal(stale.reason, "needs_approval");
  });

  it("an approval typed before any gate run binds to the first tree the gate sees", () => {
    const repo = fresh();
    saveRelease(repoRuntime(), fmPaths(repo.root), Date.now(), {
      grants: [],
      approvals: [{ task: "t1", check: "M1", reason: "looked", at: new Date().toISOString() }],
    });
    assert.equal(item(repo, "M1").status, "passed");
    repo.write("src/a.js", "export const a = 4;\n");
    assert.equal(item(repo, "M1").reason, "needs_approval");
  });
});
