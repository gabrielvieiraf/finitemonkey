import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { prOutcome } from "../src/gate/checks/pr.js";
import { gitAt } from "../src/gate/git.js";
import { parsePrList } from "../src/gate/hooks/prs.js";
import { prStatus } from "../src/gate/pr.js";
import { parseMergeTreeConflicts, parsePrView } from "../src/gate/pr-parse.js";
import { prepareGate } from "../src/gate/prepare.js";
import type { GateContext } from "../src/gate/types.js";
import { fmPaths } from "../src/task/paths.js";
import { ghWith, makeRepo, NO_PR, type Repo, repoRuntime } from "./repo.js";
import { execResult } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const view = (overrides: Readonly<Record<string, unknown>> = {}): string =>
  JSON.stringify({
    number: 42,
    url: "https://github.com/acme/shop/pull/42",
    state: "OPEN",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    baseRefName: "main",
    headRefOid: "",
    statusCheckRollup: [{ __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" }],
    ...overrides,
  });

const conflictRepo = (): Repo => {
  const repo = makeRepo({ "src/cart.ts": "export const total = 1;\n" });
  repos.push(repo);
  repo.git("checkout", "-q", "-b", "feat");
  repo.write("src/cart.ts", "export const total = 2;\n");
  repo.commit("feat side");
  repo.git("checkout", "-q", "main");
  repo.write("src/cart.ts", "export const total = 3;\n");
  repo.commit("main side");
  repo.git("checkout", "-q", "feat");
  repo.write("src/other.ts", "export const x = 1;\n");
  return repo;
};

const contextFor = (repo: Repo, gh: Parameters<typeof repoRuntime>[0]): GateContext => {
  const ready = prepareGate({
    runtime: repoRuntime(gh),
    cwd: repo.root,
    env: {},
    sessionId: undefined,
    budgetMs: 1000,
    fast: false,
    noSkip: true,
  });
  if (ready.kind !== "ready") throw new Error(`not ready: ${ready.kind}`);
  return ready.prepared.ctx;
};

const outcome = (repo: Repo, stdout: string) => {
  const ctx = contextFor(repo, { gh: ghWith(execResult(0, stdout)) });
  return prOutcome({ id: "pr", kind: "pr" }, ctx);
};

describe("PR state from gh", () => {
  it("CONFLICTING fails the gate, names the base, lists conflicted files and the safe next step", () => {
    const repo = conflictRepo();
    const result = outcome(repo, view({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }));
    assert.equal(result.status, "failed");
    assert.deepEqual(
      result.notes.map((note) => note.key),
      ["gate.pr.found", "gate.pr.conflict", "gate.pr.conflict_file", "gate.pr.conflict_next"],
    );
    assert.deepEqual(result.notes[1]?.params, { number: 42, base: "main" });
    assert.deepEqual(result.notes[2]?.params, { file: "src/cart.ts" });
    assert.equal(repo.git("status", "--porcelain", "--", ".", ":(exclude).finitemonkey").trim(), "?? src/other.ts");
  });

  it("DIRTY alone also counts as a conflict", () => {
    const repo = conflictRepo();
    assert.equal(outcome(repo, view({ mergeable: "UNKNOWN", mergeStateStatus: "DIRTY" })).status, "failed");
  });

  it("BEHIND passes with a warning that the base moved", () => {
    const repo = conflictRepo();
    const result = outcome(repo, view({ mergeStateStatus: "BEHIND" }));
    assert.equal(result.status, "passed");
    assert.ok(result.notes.some((note) => note.key === "gate.pr.behind"));
  });

  it("a clean PR with green CI passes", () => {
    const repo = conflictRepo();
    assert.equal(outcome(repo, view()).status, "passed");
  });

  it("a failed CI check fails with its name; a pending one is not verified", () => {
    const repo = conflictRepo();
    const failing = outcome(
      repo,
      view({ statusCheckRollup: [{ name: "lint", status: "COMPLETED", conclusion: "FAILURE" }] }),
    );
    assert.equal(failing.status, "failed");
    assert.deepEqual(failing.notes.at(-1), { key: "gate.pr.ci_failed", params: { name: "lint" } });
    const pending = outcome(conflictRepo(), view({ statusCheckRollup: [{ context: "ci/test", state: "PENDING" }] }));
    assert.equal(pending.status, "unverified");
    assert.deepEqual(pending.notes.at(-1), { key: "gate.pr.ci_pending", params: { name: "ci/test" } });
  });

  it("without gh, or not logged in, the PR is not verified, never passed", () => {
    const repo = conflictRepo();
    const ctx = contextFor(repo, {});
    assert.equal(prOutcome({ id: "pr", kind: "pr" }, ctx).status, "unverified");
    const missing = contextFor(repo, { gh: () => ({ ...execResult(null), found: false }) });
    assert.equal(prOutcome({ id: "pr", kind: "pr" }, missing).reason, "no_gh");
  });

  it("no PR passes when none is required and fails when the contract requires one", () => {
    const repo = conflictRepo();
    const ctx = contextFor(repo, { gh: NO_PR });
    assert.equal(prOutcome({ id: "pr", kind: "pr" }, ctx).status, "passed");
    assert.equal(prOutcome({ id: "pr", kind: "pr", requireOpen: true }, ctx).status, "failed");
  });

  it("caches the PR for a short time so the stop does not call gh every time", () => {
    const repo = conflictRepo();
    let calls = 0;
    const runtime = repoRuntime({
      gh: (args) => {
        calls += 1;
        return ghWith(execResult(0, view()))(args);
      },
    });
    const git = gitAt(runtime, repo.root);
    assert.equal(prStatus(runtime, git, fmPaths(repo.root)).kind, "found");
    const after = calls;
    assert.equal(prStatus(runtime, git, fmPaths(repo.root)).kind, "found");
    assert.equal(calls, after);
  });
});

describe("gh output parsing", () => {
  it("rejects unexpected JSON", () => {
    assert.equal(parsePrView('{"url":"x"}'), undefined);
    assert.equal(parsePrView("not json"), undefined);
  });

  it("reads git merge-tree conflict names", () => {
    assert.deepEqual(parseMergeTreeConflicts("abc123\nsrc/a.ts\nsrc/b.ts\n\nAuto-merging src/a.ts\n"), [
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("summarizes the open PR list for the session line", () => {
    assert.deepEqual(
      parsePrList(
        JSON.stringify([
          { number: 1, mergeable: "CONFLICTING" },
          { number: 2, mergeStateStatus: "BEHIND" },
          { number: 3 },
        ]),
      ),
      [
        { number: 1, state: "conflict" },
        { number: 2, state: "behind" },
        { number: 3, state: "ok" },
      ],
    );
  });
});
